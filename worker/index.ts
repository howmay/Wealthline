// Cloudflare Worker entry: answers /api/quote and leaves everything else to the static
// assets in dist/ (configured in wrangler.jsonc). Only /api/* reaches this code.
import { handleQuoteRequest } from '../server/yahoo.ts'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/api/quote') return handleQuoteRequest(url)
    return env.ASSETS.fetch(request)
  },
}
