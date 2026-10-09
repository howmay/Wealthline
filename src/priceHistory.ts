// A holding's value on each past day, worked out when it is viewed instead of stored:
// daily closes and exchange rates come from /api/history, and the quantity held on
// each day comes from the change log. Nothing here is written to Drive.

import { changeKey, keyOf, localDate, type PositionState } from './history'
import { BASE_CURRENCY, rateOf, type Account, type Position, type WealthData } from './model'

export interface PriceHistory {
  symbol: string
  currency: string
  points: { date: string; close: number }[]
}

export interface DayValue {
  date: string
  quantity: number
  price: number
  rate: number
  value: number
  live?: boolean // today, from the current numbers
}

export interface PositionTimeline {
  days: DayValue[]
  // Where the numbers are less than exact, for a note under the chart.
  startKnown: boolean
  rateFallback: boolean
}

export async function fetchHistory(symbol: string, from: string): Promise<PriceHistory | null> {
  const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&from=${from}`).catch(() => null)
  return res?.ok ? ((await res.json()) as PriceHistory) : null
}

// Yahoo's symbol for the base-currency price of one unit of `currency`.
export const fxSymbol = (currency: string) => `${currency}${BASE_CURRENCY}=X`

// The first day to show: when it was added, else the first change logged for it, else a year back.
export function startDate(data: WealthData, account: Account, p: Position, today: string): { date: string; known: boolean } {
  if (p.addedAt) return { date: localDate(p.addedAt), known: true }
  const first = logFor(data, account, p)[0]
  if (first && !first.before) return { date: localDate(first.at), known: true }
  const d = new Date(`${today}T00:00:00`)
  d.setFullYear(d.getFullYear() - 1)
  return { date: localDate(d.toISOString()), known: false }
}

const logFor = (data: WealthData, account: Account, p: Position) =>
  data.history.changes.filter((c) => c.accountId === account.id && changeKey(c) === keyOf(p)).sort((a, b) => a.at.localeCompare(b.at))

// The latest value on or before `date` in a list sorted by date.
function asOf(points: { date: string; close: number }[], date: string): number | undefined {
  let found: number | undefined
  for (const pt of points) {
    if (pt.date > date) break
    found = pt.close
  }
  return found
}

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
  const log = logFor(data, account, p)
  const current: PositionState = { quantity: p.quantity, price: p.price }
  // What was held at the end of `date`: the last logged edit by then; before the first
  // edit, what that edit started from; with no log at all, what is held now.
  const stateOn = (date: string): PositionState | null => {
    let s: PositionState | null | undefined
    for (const c of log) {
      if (localDate(c.at) > date) break
      s = c.after
    }
    if (s !== undefined) return s
    return log.length ? log[0].before : current
  }

  const manual = p.priceManual || !prices?.points.length
  const sameCurrency = !manual && prices!.currency === p.currency
  const currentRate = rateOf(data, p.currency)
  let rateFallback = false
  const rateOn = (date: string) => {
    if (p.currency === BASE_CURRENCY) return 1
    const r = fx ? asOf(fx.points, date) : undefined
    if (r) return r
    rateFallback = true
    return currentRate
  }

  // Trading days from the price history; a hand-priced holding changes only on its edits.
  // With an unknown start, the first day is simply the first price or rate on record.
  const dates = new Set<string>(start.known ? [start.date] : [])
  if (!manual) for (const pt of prices!.points) dates.add(pt.date)
  else if (fx && p.currency !== BASE_CURRENCY) for (const pt of fx.points) dates.add(pt.date)
  for (const c of log) dates.add(localDate(c.at))

  const days: DayValue[] = []
  for (const date of [...dates].sort()) {
    if (date < start.date || date >= today) continue
    const s = stateOn(date)
    if (!s || s.quantity === 0) continue
    const price = sameCurrency ? asOf(prices!.points, date) : s.price
    if (price === undefined) continue
    const rate = rateOn(date)
    if (!Number.isFinite(rate)) continue
    days.push({ date, quantity: s.quantity, price, rate, value: s.quantity * price * rate })
  }
  if (Number.isFinite(currentRate)) {
    days.push({ date: today, quantity: p.quantity, price: p.price, rate: currentRate, value: p.quantity * p.price * currentRate, live: true })
  }
  return { days, startKnown: start.known, rateFallback }
}
