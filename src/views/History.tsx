import { useState, type ReactNode } from 'react'
import { fmt, pct } from '../format'
import { localDate, snapshotOf, type Change, type Snapshot } from '../history'
import { CATEGORIES, type WealthData } from '../model'
import { displaySymbol } from '../quotes'
import { TrendChart, type Series } from './TrendChart'

const MODES = { total: '總資產', account: '依帳戶', category: '依類別' }
type Mode = keyof typeof MODES
const SLOTS = 8

interface Props {
  data: WealthData
  dirty: boolean
  busy: boolean
  onSave: () => void
  onChange: (d: WealthData) => void
  onOpenAccount: (id: string) => void
}

export function HistoryView({ data, dirty, busy, onSave, onChange, onOpenAccount }: Props) {
  const [mode, setMode] = useState<Mode>('total')
  const [accountFilter, setAccountFilter] = useState('')
  const [now] = useState(() => new Date().toISOString())
  const { snapshots: saved, changes } = data.history

  if (data.accounts.length === 0 && saved.length === 0) {
    return (
      <section className="panel empty">
        <p className="muted">還沒有資產紀錄。建立帳戶並儲存後，這裡會開始累積每天的資產變化。</p>
      </section>
    )
  }

  // Today is always shown with the current numbers; saving records it.
  const today = snapshotOf(data, now)
  const savedToday = saved.some((s) => s.date === today.date)
  const points = [...saved.filter((s) => s.date !== today.date), today]
  const dates = points.map((s) => s.date)
  const previous = points.length > 1 ? points[points.length - 2] : null
  const first = points.length > 1 ? points[0] : null

  // Accounts that have since been deleted keep their name from the last snapshot they appear in.
  const accountNames = new Map<string, string>()
  for (const s of points) for (const a of s.accounts) accountNames.set(a.id, a.name)

  return (
    <>
      <div className="page-head">
        <div>
          <h2>歷史</h2>
          <p className="muted">每天第一次登入和每次儲存，都會記下當天的資產；儲存時也會記下你改了哪些餘額或持倉。</p>
        </div>
        {!savedToday && !dirty && data.accounts.length > 0 && (
          <button className="primary" onClick={onSave} disabled={busy}>
            記錄今天的資產
          </button>
        )}
      </div>

      <section className="stats">
        <Stat label="目前總資產" value={`NT$ ${fmt(today.total, 0)}`} note={savedToday && !dirty ? '今天已記錄' : '儲存後記錄為今天'} />
        <Stat label="較上次紀錄" base={previous} total={today.total} />
        <Stat label="較最早紀錄" base={first} total={today.total} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>資產走勢</h3>
          <div className="segmented" role="group" aria-label="顯示方式">
            {(Object.keys(MODES) as Mode[]).map((m) => (
              <button key={m} className={m === mode ? 'on' : ''} aria-pressed={m === mode} onClick={() => setMode(m)}>
                {MODES[m]}
              </button>
            ))}
          </div>
        </div>
        <TrendChart dates={dates} series={seriesFor(mode, points, accountNames)} area={mode === 'total'} />
        {points.length < 2 && <p className="muted small chart-note">目前只有一天的紀錄。之後每天登入時會自動記一筆，就能看到資產隨時間的變化。</p>}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>異動紀錄</h3>
          {changes.length > 0 && (
            <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} aria-label="篩選帳戶">
              <option value="">所有帳戶</option>
              {[...new Map(changes.map((c) => [c.accountId, accountNames.get(c.accountId) ?? c.account]))].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
        <ChangeList
          changes={accountFilter ? changes.filter((c) => c.accountId === accountFilter) : changes}
          showAccount={!accountFilter}
          onOpenAccount={(id) => data.accounts.some((a) => a.id === id) && onOpenAccount(id)}
          onDelete={(c) => {
            if (!confirm(`刪除「${c.account}」${c.type === 'cash' ? `${c.currency} 餘額` : c.symbol} 的這筆異動紀錄？目前的數字不會改變。`)) return
            onChange({ ...data, history: { ...data.history, changes: changes.filter((x) => x !== c) } })
          }}
        />
      </section>

      {saved.length > 0 && (
        <details className="panel daily">
          <summary>
            <h3>每日紀錄</h3>
            <span className="muted small">{saved.length} 天 · 走勢圖的資料來源，數字不對的那天可以刪掉</span>
          </summary>
          <div className="scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>日期</th>
                  <th className="num">總資產</th>
                  <th className="num">帳戶數</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...saved].reverse().map((s) => (
                  <tr key={s.date}>
                    <td>{s.date.replace(/-/g, '/')}</td>
                    <td className="num">NT$ {fmt(s.total, 0)}</td>
                    <td className="num">{s.accounts.length}</td>
                    <td className="num">
                      <button
                        className="icon"
                        aria-label={`刪除 ${s.date} 的紀錄`}
                        title="刪除這天的紀錄"
                        onClick={() => {
                          if (!confirm(`刪除 ${s.date.replace(/-/g, '/')} 的每日紀錄？`)) return
                          onChange({ ...data, history: { ...data.history, snapshots: saved.filter((x) => x !== s) } })
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {saved.some((s) => s.date === today.date) && (
            <p className="muted small hint">今天的紀錄會在每次儲存時更新為當下的數字。</p>
          )}
        </details>
      )}
    </>
  )
}

function Stat({ label, value, note, base, total }: { label: string; value?: string; note?: string; base?: Snapshot | null; total?: number }) {
  if (base === null) {
    return (
      <div className="panel stat">
        <span className="eyebrow">{label}</span>
        <strong className="muted">—</strong>
        <span className="muted small">尚無更早的紀錄</span>
      </div>
    )
  }
  if (base && total !== undefined) {
    const diff = total - base.total
    return (
      <div className="panel stat">
        <span className="eyebrow">{label}</span>
        <strong>
          {diff >= 0 ? '+' : '−'}
          {fmt(Math.abs(diff), 0)}
          {base.total > 0 && <small> {diff >= 0 ? '+' : '−'}{pct(Math.abs(diff) / base.total)}</small>}
        </strong>
        <span className="muted small">{base.date.replace(/-/g, '/')} 為 NT$ {fmt(base.total, 0)}</span>
      </div>
    )
  }
  return (
    <div className="panel stat">
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      <span className="muted small">{note}</span>
    </div>
  )
}

// One line per entity in a fixed color slot; past the eighth, the rest fold into 其餘.
function seriesFor(mode: Mode, points: Snapshot[], accountNames: Map<string, string>): Series[] {
  if (mode === 'total') return [{ key: 'total', label: '總資產', color: 'var(--s1)', values: points.map((p) => p.total) }]

  const valueOf = (p: Snapshot, key: string) =>
    mode === 'account' ? (p.accounts.find((a) => a.id === key)?.value ?? 0) : (p.categories[key] ?? 0)
  const keys = new Set<string>()
  for (const p of points) for (const k of mode === 'account' ? p.accounts.map((a) => a.id) : Object.keys(p.categories)) keys.add(k)

  const latest = points[points.length - 1]
  // Categories keep the same colors as on the overview; the largest accounts today get their own.
  const order =
    mode === 'category'
      ? [...CATEGORIES, ...[...keys].filter((k) => !CATEGORIES.includes(k)).sort()]
      : [...keys].sort((a, b) => valueOf(latest, b) - valueOf(latest, a))
  const own = order.slice(0, SLOTS).filter((k) => keys.has(k))
  const rest = [...keys].filter((k) => !own.includes(k))
  const series: Series[] = own.map((k) => ({
    key: k,
    label: mode === 'account' ? (accountNames.get(k) ?? k) : k,
    color: `var(--s${order.indexOf(k) + 1})`,
    values: points.map((p) => valueOf(p, k)),
  }))
  if (rest.length) {
    series.push({
      key: '__rest',
      label: `其餘 ${rest.length} 個`,
      color: 'var(--other)',
      values: points.map((p) => rest.reduce((s, k) => s + valueOf(p, k), 0)),
    })
  }
  return series
}

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
