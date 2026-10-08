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

// Shared by the Vite dev server and the Cloudflare Worker: GET /api/quote?symbol=AAPL → Quote JSON, or 404.
export async function handleQuoteRequest(url: URL): Promise<Response> {
  const symbol = url.searchParams.get('symbol') ?? ''
  const quote = await yahooQuote(symbol).catch(() => null)
  return new Response(JSON.stringify(quote ?? { error: 'not_found' }), {
    status: quote ? 200 : 404,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  })
}
