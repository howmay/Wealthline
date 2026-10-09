import { useCalendarNow } from '../useCalendarNow'
import { useState, type ReactNode } from 'react'
import { useHistoricalValuations } from '../useHistoricalValuations'
import { fmt, pct } from '../format'
import { localDate, snapshotOf, totalPoints, type Change } from '../history'
import { CATEGORIES, type WealthData } from '../model'
import { displaySymbol } from '../quotes'
import { LiabilityChangeRow } from './LiabilityChange'
import { QuantityHistory, type QuantityEditRequest } from './QuantityHistory'
import type { HistoricalPoint } from '../quantityHistory'
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
  const historical = useHistoricalValuations(data)
  const [visibleDays, setVisibleDays] = useState(30)
  const [mode, setMode] = useState<Mode>('total')
  const [accountFilter, setAccountFilter] = useState('')
  const now = useCalendarNow()
  const [quantityRequest,setQuantityRequest] = useState<QuantityEditRequest>()
  const { snapshots: saved, changes } = data.history

  // Today is always shown with the current numbers; saving records it.
  const today = snapshotOf({ ...data, liabilities: data.liabilities ?? [] }, now)
  const savedToday = saved.some((s) => s.date === today.date)
  const points = totalPoints(historical.data, now)
  const dates = points.map((s) => s.date)
  const previous = points.length > 1 ? points[points.length - 2] : null
  const first = points.length > 1 ? points[0] : null

  // Accounts that have since been deleted keep their name from the last snapshot they appear in.
  const accountNames = new Map<string, string>()
  for (const s of points) for (const a of s.accounts) accountNames.set(a.id, a.name)

  return (
    <>
      {historical.status && <p className="muted small" aria-live="polite">{historical.status}</p>}
      {historical.error && <p role="alert" className="banner error">{historical.error}</p>}
      <div className="page-head">
        <div>
          <h2>歷史</h2>
          <p className="muted">選擇帳戶與標的，補登或修正當日持有數量。已填資料保留，不修改目前持倉。</p>
        </div>
        {!savedToday && !dirty && (data.accounts.length > 0 || !!data.liabilities?.length) && (
          <button className="primary" onClick={onSave} disabled={busy}>
            記錄今天的資產
          </button>
        )}
      </div>

      {!!(data.history.quantityDays?.length || data.history.holdingPeriods?.length) && <div className="row"><button disabled={historical.loading} onClick={historical.refresh}>{historical.loading ? '查詢歷史行情中…' : '重新查詢歷史行情'}</button><span className="muted small">原始快照保留原值，期間推算只補沒有快照的日期；單日補登優先。市場資料可能延遲；依實際行情日期估值，不以儲存價格兜底。</span></div>}
      <QuantityHistory data={data} onChange={onChange} request={quantityRequest} onRequest={setQuantityRequest} displayDays={historical.data.history.valuedQuantityDays ?? historical.data.history.quantityDays}/>
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

      <section className="panel">
        <h3>負債異動</h3>
        {!data.history.liabilityChanges?.length ? <p className="muted">修改負債並儲存後，這裡會保留修改前後的資料。</p> :
          <ul className="liability-changes">{[...(data.history.liabilityChanges ?? [])].sort((a, b) => b.at.localeCompare(a.at)).map((c, i) => <LiabilityChangeRow key={`${c.at}-${i}`} change={c} extra={<button className="icon" aria-label="刪除這筆負債紀錄" onClick={() => {
            if (confirm('刪除這筆負債異動紀錄？目前負債餘額不會改變。')) onChange({ ...data, history: { ...data.history, liabilityChanges: data.history.liabilityChanges?.filter((x) => x !== c) } })
          }}>×</button>} />)}</ul>}
      </section>
      <section className="stats">
        <Stat label={today.liabilityEstimated ? "目前總負債（預估）" : "目前總負債"} value={today.liabilityTotal == null ? '尚無法換算' : `NT$ ${fmt(today.liabilityTotal, 0)}`} />
        <Stat label={today.liabilityEstimated ? "目前淨資產（預估）" : "目前淨資產"} value={today.netWorth == null ? '尚無法換算' : `NT$ ${fmt(today.netWorth, 0)}`} note="總資產 − 總負債" />
      </section>
      {points.length > 0 && (
        <section className="panel daily" aria-label="每日紀錄">
          <div className="panel-head">
            <h3>每日紀錄</h3>
            <span className="muted small">{points.length} 天 · 與走勢圖共用資料；未知值不視為零。表格可左右滑動</span>
          </div>
          <div className="scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>日期</th>
                  <th className="num">總資產</th>
                  <th className="num">總負債</th>
                  <th className="num">淨資產</th>
                  <th className="num">帳戶數</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().slice(0,visibleDays).map((s) => (
                  <tr key={s.date}>
                    <td data-label="日期"><span className="daily-cell-value">{s.date.replace(/-/g, '/')}<span className="muted small">{s.periodDerived ? ' · 期間推算' : s.manual ? ' · 手動' : s.date === today.date ? ' · 目前' : ' · 原始快照'}</span></span></td>
                    <td className="num" data-label="總資產"><span className="daily-cell-value">{s.total === null ? '資料不完整' : `NT$ ${fmt(s.total, 0)}`}</span></td>
                    <td className="num" data-label="總負債"><span className="daily-cell-value">{s.liabilityEstimated && '預估 · '}{s.liabilityTotal === undefined ? '未記錄' : s.liabilityTotal === null ? '無法換算' : `NT$ ${fmt(s.liabilityTotal, 0)}`}</span></td>
                    <td className="num" data-label="淨資產"><span className="daily-cell-value">{s.liabilityEstimated && '預估 · '}{s.netWorth === undefined ? '未記錄' : s.netWorth === null ? '無法換算' : `NT$ ${fmt(s.netWorth, 0)}`}</span></td>
                    <td className="num" data-label="帳戶數"><span className="daily-cell-value">{s.accounts.length}</span></td>
                    <td className="num daily-actions">
                      <button onClick={()=>setQuantityRequest({date:s.date,expected:data.history.quantityDays?.find(d=>d.date===s.date)})}>編輯數量 {s.date}</button>
                      {!s.manual && !s.periodDerived && saved.some(x=>x.date===s.date) && <button
                        className="icon"
                        aria-label={`刪除 ${s.date} 的紀錄`}
                        title="刪除這天的原始快照"
                        onClick={() => {
                          if (!confirm(`刪除 ${s.date.replace(/-/g, '/')} 的原始快照？期間推算可能仍會顯示這天。`)) return
                          onChange({ ...data, history: { ...data.history, snapshots: saved.filter((x) => x.date !== s.date) } })
                        }}
                      >
                        ×
                      </button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {points.length > visibleDays && <button onClick={()=>setVisibleDays(n=>n+30)}>顯示更早 30 日（尚有 {points.length-visibleDays} 日）</button>}
          {saved.some((s) => s.date === today.date) && (
            <p className="muted small hint">未補登的今天會顯示目前值；已補登日期優先採手動數量估值。移除手動補登可恢復原始快照。</p>
          )}
        </section>
      )}
    </>
  )
}

function Stat({ label, value, note, base, total }: { label: string; value?: string; note?: string; base?: HistoricalPoint | null; total?: number }) {
  if (base === null || base?.total === null) {
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
function seriesFor(mode: Mode, points: HistoricalPoint[], accountNames: Map<string, string>): Series[] {
  if (mode === 'total') return [{ key: 'total', label: '總資產', color: 'var(--s1)', values: points.map((p) => p.total) }]

  const valueOf = (p: HistoricalPoint, key: string) =>
    p.total === null ? null : mode === 'account' ? (p.accounts.find((a) => a.id === key)?.value ?? 0) : (p.categories[key] ?? 0)
  const keys = new Set<string>()
  for (const p of points) for (const k of mode === 'account' ? p.accounts.map((a) => a.id) : Object.keys(p.categories)) keys.add(k)

  const latest = points[points.length - 1]
  // Categories keep the same colors as on the overview; the largest accounts today get their own.
  const order =
    mode === 'category'
      ? [...CATEGORIES, ...[...keys].filter((k) => !CATEGORIES.includes(k)).sort()]
      : [...keys].sort((a, b) => (valueOf(latest, b) ?? 0) - (valueOf(latest, a) ?? 0))
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
      values: points.map((p) => p.total === null ? null : rest.reduce((s, k) => s + (valueOf(p, k) ?? 0), 0)),
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
