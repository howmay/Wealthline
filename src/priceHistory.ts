// A holding's value on each past day, worked out when it is viewed instead of stored:
// daily closes and exchange rates come from /api/history, and the quantity held on
// each day comes from the change log. Nothing here is written to Drive.

import { changeKey, keyOf, localDate, type PositionState } from './history'
import { entryValue, instrumentKey, quoteOn, type QuantityEntry } from './quantityHistory'
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

export async function fetchHistory(symbol: string, from: string): Promise<PriceHistory | null> {
  const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&from=${from}`).catch(() => null)
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

const entryDay = (date: string, e: QuantityEntry): DayValue => ({
  date,
  quantity: e.quantity,
  price: e.type === 'cash' ? 1 : (e.price?.value ?? null),
  rate: e.currency === BASE_CURRENCY ? 1 : (e.fx?.value ?? null),
  priceDate: e.price?.date,
  rateDate: e.fx?.date,
  value: entryValue(e),
})

// Each day is valued with the quantity held then: the latest of a logged edit or a
// quantity entered on the History tab by that day. Before the first log entry it is what
// that entry started from; with no log at all, what is held now; before the holding was
// added, only entered quantities count. A quantity carried across a split is converted
// to the units held on that day. Past values never use today's market prices or rates;
// a hand-priced holding uses the price it had at the time.
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
  const current: PositionState = { quantity: lots.reduce((sum, x) => sum + x.quantity, 0), price: p.price }
  // The log keys a ticker without its currency, so one held in two currencies has no usable log.
  const mixedCurrency = account.positions.some((x) => keyOf(x) === keyOf(p) && x.currency !== p.currency)
  const log = mixedCurrency ? [] : logFor(data, account, p).filter((c) => c.currency === p.currency)
  const explicit = explicitDays(data, account, p)

  const entered = [...explicit].sort(([a], [b]) => a.localeCompare(b))

  // What was held at the end of `date` and the day that quantity was recorded, or
  // undefined when nothing says (before it was added, or an entered quantity is unknown).
  type Held = { state: PositionState | null; recorded: string }
  const stateOn = (date: string): Held | undefined => {
    let logged: Held | undefined
    for (const c of log) {
      if (localDate(c.at) > date) break
      logged = { state: c.after, recorded: localDate(c.at) }
    }
    const last = entered.filter(([d]) => d <= date).at(-1)
    if (last && (!logged || last[0] >= logged.recorded)) {
      const [recorded, e] = last
      return e.quantity === null ? undefined : { state: { quantity: e.quantity, price: e.price?.value ?? NaN }, recorded }
    }
    if (logged) return logged
    if (date < start.date) return undefined
    return log.length ? { state: log[0].before, recorded: localDate(log[0].at) } : { state: current, recorded: today }
  }

  const quoted = p.type === 'holding' && !p.priceManual && prices?.currency === p.currency
  const dates = new Set<string>(start.known ? [start.date] : [])
  for (const pt of quoted ? prices!.points : []) dates.add(pt.date)
  for (const pt of fx?.points ?? []) dates.add(pt.date)
  for (const c of log) dates.add(localDate(c.at))
  for (const date of explicit.keys()) dates.add(date)

  const days: DayValue[] = []
  let incomplete = false
  for (const date of [...dates].sort()) {
    if (date >= today) continue
    const entry = explicit.get(date)
    if (entry) {
      days.push(entryDay(date, entry))
      continue
    }
    const held = stateOn(date)
    if (!held?.state || held.state.quantity === 0) continue
    const { state, recorded } = held
    const quote = quoted ? quoteOn(prices, date) : undefined
    const rateQuote = p.currency === BASE_CURRENCY || fx?.currency !== BASE_CURRENCY ? undefined : quoteOn(fx, date)
    const quantity = quoted ? (state.quantity * splitFactor(prices, recorded)) / splitFactor(prices, date) : state.quantity
    const price = p.type === 'cash' ? 1 : quoted ? (quote?.value ?? null) : p.priceManual && Number.isFinite(state.price) ? state.price : null
    const rate = p.currency === BASE_CURRENCY ? 1 : (rateQuote?.value ?? null)
    const raw = price === null || rate === null ? null : quantity * price * rate
    const value = raw !== null && Number.isFinite(raw) ? raw : null
    if (value === null) incomplete = true
    days.push({ date, quantity, price, rate, priceDate: quote?.date, rateDate: rateQuote?.date, value })
  }

  const manualToday = explicit.get(today)
  if (manualToday) days.push(entryDay(today, manualToday))
  else {
    const rate = rateOf(data, p.currency)
    const value = lots.reduce((sum, x) => sum + x.quantity * x.price * rate, 0)
    days.push({ date: today, quantity: current.quantity, price: p.price, rate: Number.isFinite(rate) ? rate : null, value: Number.isFinite(value) ? value : null, live: true })
  }
  return { days, startKnown: start.known, incomplete }
}
