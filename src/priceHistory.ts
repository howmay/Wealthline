// A holding's value on each past day, worked out when it is viewed instead of stored:
// daily closes and exchange rates come from /api/history, and the quantity held on
// each day comes from the change log. Nothing here is written to Drive.

import { changeKey, keyOf, localDate } from './history'
import { entryValue, instrumentKey, quoteOn, repriceEntry, type QuantityEntry } from './quantityHistory'
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
// Past closes change at most once a day, so the browser's cache (an hour, set by the
// relay) is used unless the user asks to query again (`reload`).
export async function fetchHistory(symbol: string, from: string, reload = false): Promise<PriceHistory | null> {
  const key = `${symbol}:${from}`
  const cached = marketCache.get(key)
  if (!reload && cached && Date.now() - cached.at < 60_000) return cached.result
  const result = requestHistory(symbol, from, reload)
  marketCache.set(key, { at: Date.now(), result })
  if (marketCache.size > 100) marketCache.delete(marketCache.keys().next().value!)
  return result
}
async function requestHistory(symbol: string, from: string, reload: boolean): Promise<PriceHistory | null> {
  const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&from=${from}`, { cache: reload ? 'no-cache' : 'default' }).catch(() => null)
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

// Splits after `date` turn one unit then into `factor` units now.
const splitFactor = (history: PriceHistory | null, date: string) =>
  (history?.splits ?? []).filter((s) => s.date > date).reduce((factor, s) => factor * s.ratio, 1)

// A date entered on the History tab, valued with the quotes fetched for this view.
function enteredDay(date: string, stored: QuantityEntry, prices: PriceHistory | null, fx: PriceHistory | null): DayValue {
  const e = repriceEntry(stored, date, prices, fx)
  return {
    date,
    quantity: e.quantity,
    price: e.type === 'cash' ? 1 : (e.price?.value ?? null),
    rate: e.currency === BASE_CURRENCY ? 1 : (e.fx?.value ?? null),
    priceDate: e.price?.date,
    rateDate: e.fx?.date,
    value: entryValue(e),
  }
}

// Each past day is valued with the units held that day and that day's market close and
// rate; today's prices, rates and typed prices are never used for the past.
// Units held come from, newest first: a quantity entered on the History tab, which holds
// until the next logged edit or recorded day; the last logged edit; before the first edit,
// what it started from; with no log at all, each lot from the day it was added. A count
// carried across a split is converted to the units held on that day.
export function positionTimeline(
  data: WealthData,
  account: Account,
  p: Position,
  prices: PriceHistory | null,
  fx: PriceHistory | null,
  now: string,
): PositionTimeline {
  const today = localDate(now)
  const start = startDate(data, account, p, today)
  const lots = lotsOf(account, p)
  // The log keys a ticker without its currency, so one held in two currencies has no usable log.
  const mixedCurrency = account.positions.some((x) => keyOf(x) === keyOf(p) && x.currency !== p.currency)
  const log = mixedCurrency ? [] : logFor(data, account, p).filter((c) => c.currency === p.currency)
  const entered = [...explicitDays(data, account, p)].sort(([a], [b]) => a.localeCompare(b))
  const recordedDays = data.history.snapshots.map((s) => s.date)

  // Units held at the end of `date` and the day that count was recorded;
  // null before the holding existed, undefined when nothing says.
  type Held = { quantity: number; recorded: string } | null | undefined
  const heldOn = (date: string): Held => {
    let logged: Held
    for (const c of log) {
      if (localDate(c.at) > date) break
      logged = { quantity: c.after?.quantity ?? 0, recorded: localDate(c.at) }
    }
    // A recorded day's total was worked out from the logged count, so an entered
    // quantity stops there and the daily records and this chart agree.
    const last = entered.filter(([d]) => d <= date).at(-1)
    if (last && !(logged && logged.recorded > last[0]) && !recordedDays.some((d) => d > last[0] && d <= date)) {
      const [recorded, e] = last
      return e.quantity === null ? undefined : { quantity: e.quantity, recorded }
    }
    if (logged) return logged
    if (start.known && date < start.date) return null
    if (log.length) return log[0].before ? { quantity: log[0].before.quantity, recorded: localDate(log[0].at) } : null
    if (lots.some((x) => !x.addedAt)) return undefined
    const held = lots.filter((x) => localDate(x.addedAt!) <= date)
    return held.length ? { quantity: held.reduce((sum, x) => sum + x.quantity, 0), recorded: today } : null
  }

  const quoted = p.type === 'holding' && prices?.currency === p.currency
  const dates = new Set<string>(start.known ? [start.date] : [])
  for (const x of lots) if (x.addedAt) dates.add(localDate(x.addedAt))
  for (const pt of quoted ? prices!.points : []) dates.add(pt.date)
  for (const pt of fx?.points ?? []) dates.add(pt.date)
  for (const c of log) dates.add(localDate(c.at))
  for (const [date] of entered) dates.add(date)

  const days: DayValue[] = []
  let incomplete = false
  for (const date of [...dates].sort()) {
    if (date >= today) continue
    const entry = entered.find(([d]) => d === date)?.[1]
    if (entry) {
      const day = enteredDay(date, entry, prices, fx)
      if (day.value === null) incomplete = true
      days.push(day)
      continue
    }
    const held = heldOn(date)
    if (held === null) continue
    if (held === undefined) {
      // Only a known start says the holding existed; otherwise the day is left out.
      if (start.known && date >= start.date) {
        days.push({ date, quantity: null, price: null, rate: null, value: null })
        incomplete = true
      }
      continue
    }
    const quantity = quoted ? (held.quantity * splitFactor(prices, held.recorded)) / splitFactor(prices, date) : held.quantity
    const quote = quoted ? quoteOn(prices, date) : undefined
    const rateQuote = p.currency === BASE_CURRENCY || fx?.currency !== BASE_CURRENCY ? undefined : quoteOn(fx, date)
    const price = p.type === 'cash' ? 1 : (quote?.value ?? null)
    const rate = p.currency === BASE_CURRENCY ? 1 : (rateQuote?.value ?? null)
    const raw = quantity === 0 ? 0 : price === null || rate === null ? null : quantity * price * rate
    const value = raw !== null && Number.isFinite(raw) ? raw : null
    if (value === null) incomplete = true
    days.push({ date, quantity, price, rate, priceDate: quote?.date, rateDate: rateQuote?.date, value })
  }

  const enteredToday = entered.find(([d]) => d === today)?.[1]
  if (enteredToday) days.push(enteredDay(today, enteredToday, prices, fx))
  else {
    const rate = rateOf(data, p.currency)
    const value = lots.reduce((sum, x) => sum + x.quantity * x.price * rate, 0)
    days.push({ date: today, quantity: lots.reduce((sum, x) => sum + x.quantity, 0), price: p.price, rate: Number.isFinite(rate) ? rate : null, value: Number.isFinite(value) ? value : null, live: true })
  }
  return { days, startKnown: start.known, incomplete }
}
