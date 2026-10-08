import { useState } from 'react'
import { fmt } from '../format'
import { positionHistory, snapshotOf, type PositionValue } from '../history'
import { displaySymbol } from '../quotes'
import { BASE_CURRENCY, type Account, type Position, type WealthData } from '../model'
import { TrendChart } from './TrendChart'

const day = (iso: string) => new Date(iso).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })

// When a holding was added and what it was worth on each recorded day, with today live.
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
  const today = snapshotOf({ ...data, accounts: [{ ...account, positions: [p] }] }, now)
  const past = positionHistory(data.history.snapshots, account.id, p).filter((x) => x.date !== today.date)
  const live = today.positions[0]
  const points: { date: string; v: PositionValue; live?: boolean }[] = [...past, ...(live ? [{ date: today.date, v: live, live: true }] : [])]
  const first = points[0]
  const diff = points.length > 1 ? points[points.length - 1].v.value - first.v.value : null

  return (
    <div className="position-history">
      <div className="panel-head">
        <h4>{displaySymbol(p.symbol)} 每日價值</h4>
        <button className="icon" aria-label="收起" title="收起" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="muted small">
        {p.addedAt ? `${day(p.addedAt)} 加入` : '加入日期不明（早於開始記錄加入日期）'}
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
      {points.length > 0 ? (
        <>
          <TrendChart dates={points.map((x) => x.date)} series={[{ key: 'v', label: '台幣價值', color: 'var(--s1)', values: points.map((x) => x.v.value) }]} area />
          {points.length < 2 && <p className="muted small chart-note">之後每天第一次登入時會自動記一筆，就能看到這個標的的價值變化。</p>}
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
                {[...points]
                  .reverse()
                  .slice(0, shown)
                  .map(({ date, v, live }) => (
                    <tr key={date}>
                      <td>
                        {date.replace(/-/g, '/')}
                        {live && <span className="muted small"> 目前</span>}
                      </td>
                      <td className="num">{fmt(v.quantity, 8)}</td>
                      <td className="num">
                        {fmt(v.price, 4)} <span className="muted small">{v.currency}</span>
                      </td>
                      <td className="num">{v.currency === BASE_CURRENCY ? '—' : fmt(v.rate, 4)}</td>
                      <td className="num">{fmt(v.value, 0)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {points.length > shown && (
            <button className="ghost small" onClick={() => setShown(shown + 30)}>
              顯示更早的紀錄（還有 {points.length - shown} 天）
            </button>
          )}
        </>
      ) : (
        <p className="muted small">還沒有這個標的的匯率，設定匯率後就能記錄它的台幣價值。</p>
      )}
    </div>
  )
}
