// Cloudflare Worker entry: answers /api/quote and leaves everything else to the static
// assets in dist/ (configured in wrangler.jsonc), applying security headers to both.
import { handleQuoteRequest } from '../server/yahoo.ts'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const result = request.method === 'GET' && url.pathname === '/api/quote'
      ? await handleQuoteRequest(url)
      : await env.ASSETS.fetch(request)
    const response = new Response(result.body, result)
    response.headers.set('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' https://accounts.google.com/gsi/client",
      "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
      "connect-src 'self' https://accounts.google.com/gsi/ https://www.googleapis.com https://oauth2.googleapis.com https://open.er-api.com https://api.coingecko.com",
      "frame-src https://accounts.google.com/gsi/",
      "img-src 'self' data: https://*.googleusercontent.com",
      "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
    ].join('; '))
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('X-Frame-Options', 'DENY')
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
    response.headers.set('Strict-Transport-Security', 'max-age=31536000')
    return response
  },
}
