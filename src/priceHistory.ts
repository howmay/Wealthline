// A holding's value on each past day, worked out when it is viewed instead of stored:
// daily closes and exchange rates come from /api/history, and the quantity held on
// each day comes from the change log. Nothing here is written to Drive.

import { changeKey, keyOf, localDate, type PositionState } from './history'
import { instrumentKey, quoteOn, repriceEntry, entryValue, type QuantityEntry } from './quantityHistory'
import { BASE_CURRENCY, rateOf, type Account, type Position, type WealthData } from './model'

export interface PriceHistory {
  symbol: string
  currency: string
  asTraded?: boolean
  splits?: { date: string; ratio: number }[]
  points: { date: string; close: number }[]
}

export interface DayValue {
  date: string
  quantity: number | null
  price: number | null
  rate: number | null
  priceDate?: string
  rateDate?: string
  value: number | null
  live?: boolean // today, from the current numbers
}

export interface PositionTimeline {
  days: DayValue[]
  // Where the numbers are less than exact, for a note under the chart.
  startKnown: boolean
  incomplete: boolean // some days lack a price, rate or quantity
}

const marketCache = new Map<string, { at: number; result: Promise<PriceHistory | null> }>()
export function clearHistoryCache() { marketCache.clear() }
export async function fetchHistory(symbol: string, from: string): Promise<PriceHistory | null> {
  const key = `${symbol}:${from}`
  const cached = marketCache.get(key)
  if (cached && Date.now() - cached.at < 60_000) return cached.result
  const result = requestHistory(symbol, from)
  marketCache.set(key, { at: Date.now(), result })
  if (marketCache.size > 100) marketCache.delete(marketCache.keys().next().value!)
  return result
}
async function requestHistory(symbol: string, from: string): Promise<PriceHistory | null> {
  const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&from=${from}`, { cache: 'no-cache' }).catch(() => null)
  try {
    const body = res?.ok ? await res.json() as PriceHistory : null
    return body && Array.isArray(body.points) && typeof body.currency === 'string' && typeof body.symbol === 'string' && body.points.every(p => p && typeof p.date === 'string' && Number.isFinite(p.close) && p.close > 0) && (body.splits === undefined || Array.isArray(body.splits) && body.splits.every(s => s && typeof s.date === 'string' && Number.isFinite(s.ratio) && s.ratio > 0)) ? body : null
  } catch { return null }
}

// Yahoo's symbol for the base-currency price of one unit of `currency`.
export const fxSymbol = (currency: string) => `${currency}${BASE_CURRENCY}=X`

// The lots of one holding that are counted together: same account, ticker and currency.
const lotsOf = (account: Account, p: Position) => account.positions.filter((x) => keyOf(x) === keyOf(p) && x.currency === p.currency)

// The first day to show: when the earliest lot was added, else the first change logged
// for it, else a year back.
export function startDate(data: WealthData, account: Account, p: Position, today: string): { date: string; known: boolean } {
  const added = lotsOf(account, p).map((x) => x.addedAt).filter((at): at is string => !!at).sort()[0] ?? p.addedAt
  if (added) return { date: localDate(added), known: true }
  const first = logFor(data, account, p)[0]
  if (first && !first.before) return { date: localDate(first.at), known: true }
  const d = new Date(`${today}T00:00:00`)
  d.setFullYear(d.getFullYear() - 1)
  return { date: localDate(d.toISOString()), known: false }
}

const logFor = (data: WealthData, account: Account, p: Position) =>
  data.history.changes.filter((c) => c.accountId === account.id && changeKey(c) === keyOf(p)).sort((a, b) => a.at.localeCompare(b.at))

// Quantities entered on the History tab for this holding, by date.
export function explicitDays(data: WealthData, account: Account, p: Position): Map<string, QuantityEntry> {
  const key = instrumentKey({ accountId: account.id, account: account.name, category: account.category, country: account.country, ...p })
  const days = new Map<string, QuantityEntry>()
  for (const d of data.history.quantityDays ?? []) {
    const entry = d.entries.find((e) => instrumentKey(e) === key)
    if (entry) days.set(d.date, entry)
  }
  return days
}

// Historical values never use today's prices or rates. Legacy changes identify
// aggregate instrument quantities, not lots; unknown prehistory remains unknown.
export function positionTimeline(
  data: WealthData, account: Account, p: Position,
  prices: PriceHistory | null, fx: PriceHistory | null, now: string,
): PositionTimeline {
  const today = localDate(now)
  const start = startDate(data, account, p, today)
  const mixedCurrency = account.positions.some(x => keyOf(x) === keyOf(p) && x.currency !== p.currency)
  const log = mixedCurrency ? [] : logFor(data, account, p).filter(c => c.currency === p.currency)
  const explicit = (data.history.quantityDays ?? []).flatMap(d => {
    const entry = d.entries.find(e => instrumentKey(e) === instrumentKey({accountId:account.id,account:account.name,category:account.category,country:account.country,...p}))
    return entry ? [{date:d.date,entry}] : []
  })
  const lower = [start.date, ...explicit.map(d => d.date)].sort()[0]
  const stateOn = (date:string): PositionState | null | undefined => {
    let state: PositionState | null | undefined
    for(const c of log) {if(localDate(c.at)>date)break;state=c.after}
    return state
  }
  const dates = new Set<string>()
  for(const pt of prices?.points ?? []) dates.add(pt.date)
  for(const pt of fx?.points ?? []) dates.add(pt.date)
  for(const c of log) dates.add(localDate(c.at))
  for(const d of explicit) dates.add(d.date)
  const days: DayValue[]=[]
  let incomplete=false
  for(const date of [...dates].sort()) {
    if(date>=today)continue
    const manual = explicit.find(d=>d.date===date)?.entry
    if(manual){const fresh=repriceEntry(manual,date,prices,fx);days.push({date,quantity:fresh.quantity,price:fresh.type==='cash'?1:fresh.price?.value??null,rate:fresh.currency==='TWD'?1:fresh.fx?.value??null,priceDate:fresh.price?.date,rateDate:fresh.fx?.date,value:entryValue(fresh)});if(entryValue(fresh)===null)incomplete=true;continue}
    if(date<lower)continue
    const state=stateOn(date)
    if(state===undefined){days.push({date,quantity:null,price:null,rate:null,value:null});incomplete=true;continue}
    const quantity=state?.quantity??0
    const quote=prices?.currency===p.currency?quoteOn(prices,date):undefined
    const rateQuote=fx?.currency===BASE_CURRENCY?quoteOn(fx,date):undefined
    const price=p.type==='cash'?1:quote?.value??null
    const rate=p.currency===BASE_CURRENCY?1:rateQuote?.value??null
    // Never carry a logged quantity across a split without an explicit quantity
    // for that date: splits change units, and legacy logs are not transactions.
    const last=log.filter(c=>localDate(c.at)<=date).at(-1)
    const splitUnknown=quantity !== 0 && !!last && prices?.splits?.some(s=>s.date>localDate(last.at)&&s.date<=date)
    const value=quantity===0?0:splitUnknown||price===null||rate===null?null:quantity*price*rate
    if(value===null)incomplete=true
    days.push({date,quantity:splitUnknown?null:quantity,price,rate,priceDate:quote?.date,rateDate:rateQuote?.date,value:value!==null&&Number.isFinite(value)?value:null})
  }
  const storedToday=explicit.find(d=>d.date===today)?.entry
  const manualToday=storedToday?repriceEntry(storedToday,today,prices,fx):undefined
  if(manualToday)days.push({date:today,quantity:manualToday.quantity,price:manualToday.type==='cash'?1:manualToday.price?.value??null,rate:manualToday.currency==='TWD'?1:manualToday.fx?.value??null,priceDate:manualToday.price?.date,rateDate:manualToday.fx?.date,value:entryValue(manualToday)})
  else {
    const group=account.positions.filter(x=>keyOf(x)===keyOf(p)&&x.currency===p.currency)
    const quantity=group.reduce((sum,x)=>sum+x.quantity,0)
    const rate=rateOf(data,p.currency)
    const value=group.reduce((sum,x)=>sum+x.quantity*x.price*rate,0)
    days.push({date:today,quantity,price:p.price,rate:Number.isFinite(rate)?rate:null,value:Number.isFinite(value)?value:null,live:true})
  }
  return {days,startKnown:start.known,incomplete}
}
