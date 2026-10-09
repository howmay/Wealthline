import { useEffect, useState } from 'react'
import { fmt } from '../format'
import { localDate } from '../history'
import { BASE_CURRENCY, type Account, type Position, type WealthData } from '../model'
import { clearHistoryCache, explicitDays, fetchHistory, fxSymbol, positionTimeline, startDate, type PriceHistory } from '../priceHistory'
import { candidates, displaySymbol } from '../quotes'
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
  const [generation, setGeneration] = useState(0)
  const [shown, setShown] = useState(10)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  // Fetch far enough back for this instrument’s selected-day entries.
  const from = [startDate(data, account, p, localDate(now)).date, ...explicitDays(data, account, p).keys()].sort()[0]

  useEffect(() => {
    let live = true
    void Promise.all([
      p.type === 'cash' ? null : (async () => {
        for (const symbol of candidates(p.symbol, account.country, account.category.includes('加密'))) {
          const history = await fetchHistory(symbol, from)
          if (history?.currency === p.currency && history.points.length) return history
        }
        return null
      })(),
      p.currency === BASE_CURRENCY ? null : fetchHistory(fxSymbol(p.currency), from),
    ]).then(([prices, fx]) => live && setLoaded({ prices, fx }))
    return () => {
      live = false
    }
  }, [p.type, p.symbol, p.currency, p.priceManual, from, generation, account.country, account.category])

  const head = (
    <div className="panel-head">
      <h4>{p.type === 'cash' ? `${p.currency} 餘額` : displaySymbol(p.symbol)} 每日價值</h4>
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

  const { days, startKnown, incomplete } = positionTimeline(data, account, p, loaded.prices, loaded.fx, now)
  const first = days[0]
  const diff = days.length > 1 && days[days.length - 1].value !== null && first.value !== null ? days[days.length - 1].value! - first.value : null
  const notes = [
    p.type === 'holding' && !loaded.prices && '抓不到歷史股價，過去的日子不估值。',
    '歷史只使用查詢取得的市場行情；不使用手填現價。補登只影響選定日期。',
    p.type === 'cash' && p.currency === BASE_CURRENCY && '台幣餘額只在你修改時變動。',
    '同帳戶、同標的、同幣別的多筆一起計算；拆股後缺少可靠數量時保持未知。',
    incomplete && '部分日期缺少歷史價格或匯率，顯示未知，不以目前值補算。',
    !startKnown && '加入日期不明，不回推目前數量。可在歷史頁補登實際數量。',
  ].filter(Boolean)

  return (
    <div className="position-history">
      {head}
      <button onClick={() => { clearHistoryCache(); setLoaded(null); setGeneration(g => g + 1) }}>重新查詢歷史行情</button>
      <p className="muted small">市場資料可能延遲；歷史以已完成行情估值，實際日期列於明細。</p>
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
                  <th className="num">{p.type === 'cash' ? '餘額' : '數量'}</th>
                  {p.type === 'holding' && <th className="num">價格</th>}
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
                      <td className="num">{v.quantity === null ? '未知' : fmt(v.quantity, 8)}</td>
                      {p.type === 'holding' && (
                        <td className="num">
                          {v.price === null ? '未知' : fmt(v.price, 4)} <span className="muted small">{p.currency}</span><div className="muted small">{v.priceDate}</div>
                        </td>
                      )}
                      <td className="num">{p.currency === BASE_CURRENCY ? '—' : v.rate === null ? '未知' : fmt(v.rate, 4)}</td>
                      <td className="num">{v.value === null ? '未知' : fmt(v.value, 0)}<div className="muted small">{v.rateDate && `匯率日 ${v.rateDate}`}</div></td>
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
        <p className="muted small">沒有可驗證的歷史數量或行情；請至歷史頁補登。</p>
      )}
    </div>
  )
}
