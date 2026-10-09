import type { HistoricalQuote } from '../quantityHistory'
import { fmt } from '../format'
export function HistoricalFxValue({quote}:{quote:HistoricalQuote}) {
  if(quote.source==='derived' && quote.legs) return <span className="small historical-fx-chain">
    <span>經 USD 換算：{fmt(quote.value,6)} TWD</span>
    {quote.legs.map(leg=><span style={{display:'block',overflowWrap:'anywhere'}} key={leg.symbol}>Yahoo {leg.symbol} · {leg.date} · {fmt(leg.value,8)} {leg.currency}</span>)}
  </span>
  return <span>Yahoo {quote.symbol} · {quote.date} 匯率 {fmt(quote.value,6)}</span>
}
