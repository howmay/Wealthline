import { useState, type ReactNode } from 'react'
import { fmt } from '../format'
import { localDate, type Change } from '../history'
import { displaySymbol } from '../quotes'

const signed = (n: number, digits: number) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n), digits)}`

export function ChangeRow({
  c,
  showAccount,
  onOpenAccount,
  showTime = true,
  extra,
}: {
  c: Change
  showAccount: boolean
  onOpenAccount?: (id: string) => void
  showTime?: boolean
  extra?: ReactNode
}) {
  const what = c.type === 'cash' ? `${c.currency} 餘額` : displaySymbol(c.symbol)
  const time = new Date(c.at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
  let detail: React.ReactNode
  if (!c.before || !c.after) {
    const s = (c.after ?? c.before)!
    detail = (
      <>
        <span className={`tag ${c.after ? 'good' : ''}`}>{c.after ? '新增' : '移除'}</span>
        <span className="num">
          {c.type === 'cash' ? `${fmt(s.quantity)} ${c.currency}` : `${fmt(s.quantity, 8)} × ${fmt(s.price, 4)} ${c.currency}`}
        </span>
      </>
    )
  } else {
    const qty = c.after.quantity - c.before.quantity
    const priceChanged = c.type === 'holding' && c.after.price !== c.before.price
    detail = (
      <>
        {qty !== 0 && (
          <span className="num">
            {c.type === 'holding' && <span className="muted">數量 </span>}
            <span className="muted">{fmt(c.before.quantity, 8)} →</span> {fmt(c.after.quantity, 8)}
            <span className="delta">{signed(qty, 8)}</span>
          </span>
        )}
        {priceChanged && (
          <span className="num">
            <span className="muted">單價 {fmt(c.before.price, 4)} →</span> {fmt(c.after.price, 4)} {c.currency}
          </span>
        )}
      </>
    )
  }
  return (
    <li className={showTime ? '' : 'no-time'}>
      {showTime && <span className="when muted small">{time}</span>}
      <span className="what">
        {showAccount &&
          (onOpenAccount ? (
            <button className="link acct" onClick={() => onOpenAccount(c.accountId)}>
              {c.account}
            </button>
          ) : (
            <span className="acct">{c.account}</span>
          ))}
        <strong>{what}</strong>
      </span>
      <span className="detail">
        {detail}
        {extra}
      </span>
    </li>
  )
}

// Edits grouped by day, newest first.
export function ChangeList({
  changes,
  showAccount = true,
  onOpenAccount,
  onDelete,
  limit = 60,
}: {
  changes: Change[]
  showAccount?: boolean
  onOpenAccount?: (id: string) => void
  onDelete?: (c: Change) => void
  limit?: number
}) {
  const [shown, setShown] = useState(limit)
  if (changes.length === 0) {
    return <p className="muted">還沒有異動。修改餘額或持倉並儲存後，原本的數字會記錄在這裡。</p>
  }
  const sorted = [...changes].sort((a, b) => b.at.localeCompare(a.at))
  const days = new Map<string, Change[]>()
  for (const c of sorted.slice(0, shown)) {
    const d = localDate(c.at)
    days.set(d, [...(days.get(d) ?? []), c])
  }
  return (
    <div className="changes">
      {[...days].map(([day, list]) => (
        <div key={day} className="change-day">
          <h4>{day.replace(/-/g, '/')}</h4>
          <ul>
            {list.map((c, i) => (
              <ChangeRow
                key={`${c.at}-${i}`}
                c={c}
                showAccount={showAccount}
                onOpenAccount={onOpenAccount}
                extra={
                  onDelete && (
                    <button className="icon" aria-label="刪除這筆紀錄" title="刪除這筆紀錄" onClick={() => onDelete(c)}>
                      ×
                    </button>
                  )
                }
              />
            ))}
          </ul>
        </div>
      ))}
      {sorted.length > shown && (
        <button className="ghost small" onClick={() => setShown(shown + limit)}>
          顯示更早的紀錄（還有 {sorted.length - shown} 筆）
        </button>
      )}
    </div>
  )
}
