// Cloudflare Worker entry: answers /api/quote and /api/history, and leaves everything else to the static
// assets in dist/ (configured in wrangler.jsonc), applying security headers to both.
import { handleApiRequest, isApiPath } from '../server/yahoo.ts'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const result = request.method === 'GET' && isApiPath(url.pathname)
      ? await handleApiRequest(url)
      : await env.ASSETS.fetch(request)
    const response = new Response(result.body, result)
    // run_worker_first bypasses public/_headers, so keep HTML revalidated here (see that file).
    if (response.headers.get('Content-Type')?.includes('text/html')) {
      response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate')
      response.headers.set('Cloudflare-CDN-Cache-Control', 'no-store')
    }
    response.headers.set('Content-Security-Policy', [
      "default-src 'self'",
      // The hash is index.html's inline restore script (tests/security.test.mjs keeps them in sync).
      "script-src 'self' 'sha256-UblZoFFqwlfgLp5nOmM8nQhFOFMfzeCgsmh9eDOMlBY=' https://accounts.google.com/gsi/client",
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
