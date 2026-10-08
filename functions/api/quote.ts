// Cloudflare Pages Function: GET /api/quote?symbol=2330.TW
import { handleQuoteRequest } from '../../server/yahoo.ts'

export const onRequestGet = ({ request }: { request: Request }) => handleQuoteRequest(new URL(request.url))
