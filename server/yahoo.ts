// Looks up a market price from Yahoo Finance's chart endpoint. Runs server-side only
// (Cloudflare Worker in production, Vite dev server locally) because Yahoo
// does not allow browser requests from other sites. No user data passes through here.

export interface Quote {
  symbol: string
  price: number
  currency: string
  name: string
}

const SYMBOL = /^[A-Za-z0-9.\-=^]{1,24}$/

export async function yahooQuote(symbol: string): Promise<Quote | null> {
  if (!SYMBOL.test(symbol)) return null
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (we-wealth quote lookup)' } })
  if (!res.ok) return null
  const body = (await res.json()) as {
    chart?: { result?: { meta?: { regularMarketPrice?: number; currency?: string; longName?: string; shortName?: string; symbol?: string } }[] }
  }
  const meta = body.chart?.result?.[0]?.meta
  if (!meta?.regularMarketPrice || !meta.currency) return null
  return {
    symbol: meta.symbol ?? symbol,
    price: meta.regularMarketPrice,
    currency: meta.currency.toUpperCase(),
    name: meta.longName ?? meta.shortName ?? symbol,
  }
}

export interface PriceHistory {
  symbol: string
  currency: string
  points: { date: string; close: number }[] // exchange-local YYYY-MM-DD, oldest first
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_YEARS = 10

// Daily closes since `from`. Yahoo's closes are adjusted for splits, not dividends.
export async function yahooHistory(symbol: string, from: string): Promise<PriceHistory | null> {
  if (!SYMBOL.test(symbol) || !DATE.test(from)) return null
  const start = Math.max(Date.parse(`${from}T00:00:00Z`), Date.now() - MAX_YEARS * 365 * 86400_000)
  if (!Number.isFinite(start)) return null
  const period1 = Math.floor(start / 1000) - 86400
  const period2 = Math.floor(Date.now() / 1000)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (we-wealth quote lookup)' } })
  if (!res.ok) return null
  const body = (await res.json()) as {
    chart?: {
      result?: {
        meta?: { currency?: string; symbol?: string; gmtoffset?: number }
        timestamp?: number[]
        indicators?: { quote?: { close?: (number | null)[] }[] }
      }[]
    }
  }
  const r = body.chart?.result?.[0]
  const closes = r?.indicators?.quote?.[0]?.close ?? []
  if (!r?.meta?.currency || !r.timestamp) return null
  const offset = r.meta.gmtoffset ?? 0
  const byDate = new Map<string, number>()
  r.timestamp.forEach((t, i) => {
    const c = closes[i]
    if (typeof c === 'number' && c > 0) byDate.set(new Date((t + offset) * 1000).toISOString().slice(0, 10), c)
  })
  return {
    symbol: r.meta.symbol ?? symbol,
    currency: r.meta.currency.toUpperCase(),
    points: [...byDate].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date)),
  }
}

// Shared by the Vite dev server and the Cloudflare Worker:
// GET /api/quote?symbol=AAPL → Quote JSON, GET /api/history?symbol=AAPL&from=2025-01-31 → PriceHistory JSON, or 404.
export const isApiPath = (path: string) => path === '/api/quote' || path === '/api/history'

export async function handleApiRequest(url: URL): Promise<Response> {
  const symbol = url.searchParams.get('symbol') ?? ''
  const history = url.pathname === '/api/history'
  const result = await (history ? yahooHistory(symbol, url.searchParams.get('from') ?? '') : yahooQuote(symbol)).catch(() => null)
  return new Response(JSON.stringify(result ?? { error: 'not_found' }), {
    status: result ? 200 : 404,
    // Past closes change only once a day.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${history ? 3600 : 300}` },
  })
}
