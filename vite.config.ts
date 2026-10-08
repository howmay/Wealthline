import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { handleQuoteRequest } from './server/yahoo.ts'

// Serves /api/quote during `npm run dev` and `npm run preview`, mirroring the
// Cloudflare Worker in worker/index.ts.
function quoteApi(): Plugin {
  const middleware = async (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/quote')) return next()
    const r = await handleQuoteRequest(new URL(req.url, 'http://localhost'))
    res.statusCode = r.status
    r.headers.forEach((v, k) => res.setHeader(k, v))
    res.end(await r.text())
  }
  return {
    name: 'quote-api',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), quoteApi()],
})
