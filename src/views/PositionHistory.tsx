import { useEffect, useState } from 'react'
import { fmt } from '../format'
import { localDate } from '../history'
import { BASE_CURRENCY, type Account, type Position, type WealthData } from '../model'
import { fetchHistory, fxSymbol, positionTimeline, startDate, type PriceHistory } from '../priceHistory'
import { displaySymbol } from '../quotes'
import { TrendChart } from './TrendChart'

const day = (iso: string) => new Date(iso).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })

type Loaded = { prices: PriceHistory | null; fx: PriceHistory | null }

// When a holding was added and what it was worth on each day since, from past closes,
// past exchange rates and the quantities in the change log.
export function PositionHistory({
  data,
  account,
  position: p,
  onClose,
}: {
  data: WealthData
  account: Account
  position: Position
  onClose: () => void
}) {
  const [now] = useState(() => new Date().toISOString())
  const [shown, setShown] = useState(10)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const from = startDate(data, account, p, localDate(now)).date

  useEffect(() => {
    let live = true
    void Promise.all([
      p.priceManual ? null : fetchHistory(p.symbol, from),
      p.currency === BASE_CURRENCY ? null : fetchHistory(fxSymbol(p.currency), from),
    ]).then(([prices, fx]) => live && setLoaded({ prices, fx }))
    return () => {
      live = false
    }
  }, [p.symbol, p.currency, p.priceManual, from])

  const head = (
    <div className="panel-head">
      <h4>{displaySymbol(p.symbol)} 每日價值</h4>
      <button className="icon" aria-label="收起" title="收起" onClick={onClose}>
        ×
      </button>
    </div>
  )
  if (!loaded) {
    return (
      <div className="position-history">
        {head}
        <p className="muted small">讀取歷史價格中…</p>
      </div>
    )
  }

  const { days, startKnown, rateFallback } = positionTimeline(data, account, p, loaded.prices, loaded.fx, now)
  const first = days[0]
  const diff = days.length > 1 ? days[days.length - 1].value - first.value : null
  const notes = [
    !p.priceManual && !loaded.prices && '抓不到歷史股價，過去的日子以當時記錄的價格計算。',
    p.priceManual && '這個標的是手動價格，價值只在你修改時變動。',
    rateFallback && '部分日期抓不到歷史匯率，以目前匯率計算。',
    !startKnown && '加入日期不明，先顯示最近一年。',
  ].filter(Boolean)

  return (
    <div className="position-history">
      {head}
      <p className="muted small">
        {p.addedAt ? `${day(p.addedAt)} 加入` : '加入日期不明'}
        {diff !== null && (
          <>
            {' · '}自 {first.date.replace(/-/g, '/')} 起價值{' '}
            <span className="num">
              {diff >= 0 ? '+' : '−'}
              {fmt(Math.abs(diff), 0)} {BASE_CURRENCY}
            </span>
          </>
        )}
      </p>
      {days.length > 0 ? (
        <>
          <TrendChart dates={days.map((x) => x.date)} series={[{ key: 'v', label: '台幣價值', color: 'var(--s1)', values: days.map((x) => x.value) }]} area />
          {notes.length > 0 && <p className="muted small chart-note">{notes.join(' ')}</p>}
          <div className="scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>日期</th>
                  <th className="num">數量</th>
                  <th className="num">價格</th>
                  <th className="num">匯率</th>
                  <th className="num">{BASE_CURRENCY}</th>
                </tr>
              </thead>
              <tbody>
                {[...days]
                  .reverse()
                  .slice(0, shown)
                  .map((v) => (
                    <tr key={v.date}>
                      <td>
                        {v.date.replace(/-/g, '/')}
                        {v.live && <span className="muted small"> 目前</span>}
                      </td>
                      <td className="num">{fmt(v.quantity, 8)}</td>
                      <td className="num">
                        {fmt(v.price, 4)} <span className="muted small">{p.currency}</span>
                      </td>
                      <td className="num">{p.currency === BASE_CURRENCY ? '—' : fmt(v.rate, 4)}</td>
                      <td className="num">{fmt(v.value, 0)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {days.length > shown && (
            <button className="ghost small" onClick={() => setShown(shown + 30)}>
              顯示更早的紀錄（還有 {days.length - shown} 天）
            </button>
          )}
        </>
      ) : (
        <p className="muted small">還沒有這個幣別的匯率，設定匯率後就能看到它的台幣價值。</p>
      )}
    </div>
  )
}
