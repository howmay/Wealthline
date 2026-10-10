import { useCalendarNow } from '../useCalendarNow'
import { useState } from 'react'
import type { HistoricalPoint } from '../quantityHistory'
import { snapshotOf, totalPoints } from '../history'
import { HistoryView } from './History'
import { seriesFor, MODES, type Mode } from './historySeries'
import { removalMessage } from '../historyCompletion'
import { QuantityEditor, type QuantityEditRequest } from './QuantityHistory'
import { SnapshotDetails } from './SnapshotDetails'
import { TrendChart } from './TrendChart'
import { useHistoricalValuations } from '../useHistoricalValuations'
import { balanceSheet } from '../liabilities'
import { fmt } from '../format'
import {
  CATEGORIES,
  COMMON_CURRENCIES,
  COUNTRIES,
  breakdown,
  countryLabel,
  missingRates,
  type WealthData,
} from '../model'
import { colorize } from '../chartColors'
import { ChangeSinceLast } from './AssetChange'
import { Allocation, RankBars } from './charts'

interface Props {
  data: WealthData
  busy?: boolean
  dirty?: boolean
  onSave?: () => void
  onCommitHistory?: (data: WealthData) => void
  onGoRates: () => void
  onGoLiabilities?: () => void
  onNewAccount: () => void
  onImport: () => void
  onOpenAccount: (name: string) => void
}

export function Overview({ data, busy = false, dirty = false, onSave, onCommitHistory, onGoRates, onGoLiabilities, onNewAccount, onImport, onOpenAccount }: Props) {
  const now = useCalendarNow()
  const estimated = data.liabilities?.some(d => d.schedule)
  const historical = useHistoricalValuations(data)
  const [selected, setSelected] = useState('current')
  const [mode, setMode] = useState<Mode>('total')
  const locked = busy || dirty
  const [editing, setEditing] = useState<QuantityEditRequest>()
  const [undo, setUndo] = useState<{ before: WealthData['history']; after: WealthData['history'] }>()
  const commit = (next: WealthData) => {
    onCommitHistory?.(next)
    setUndo({ before: data.history, after: next.history })
  }
  const live = snapshotOf(data, now)
  const points: HistoricalPoint[] = [...totalPoints(historical.data, now).filter(p => p.date !== live.date || p.manual), live]
  const chartPoints = totalPoints(historical.data, now)
  const accountNames = new Map(chartPoints.flatMap(p => p.accounts.map(a => [a.id, a.name] as const)))
  const keys = points.map((p, i) => i === points.length - 1 ? 'current' : p.date)
  const index = Math.max(0, keys.includes(selected) ? keys.indexOf(selected) : points.length - 1)
  const point = points[index]
  const current = keys[index] === 'current'
  if (data.accounts.length === 0 && !data.liabilities?.length && points.length === 1) {
    return (
      <section className="panel empty">
        <div className="empty-mark" aria-hidden>
          ＄
        </div>
        <h2>開始記錄你的資產</h2>
        <p className="muted">先建立銀行或投資帳戶，再填入餘額與持倉。也可以直接貼上現有的試算表。</p>
        <div className="row center">
          <button className="primary" onClick={onNewAccount}>
            建立第一個帳戶
          </button>
          {onGoLiabilities && <button onClick={onGoLiabilities}>新增負債</button>}
          <button onClick={onImport}>從試算表匯入</button>
        </div>
      </section>
    )
  }

  const totals = balanceSheet(data, now)
  const missing = missingRates(data)
  const byCategory = breakdown(data, (a) => a.category)

  return (
    <div className="overview">
      <section className="panel span-2 snapshot-timeline" aria-label="資產時間線">
        <div className="panel-head">
          <div><span className="eyebrow">資產時間線</span><h2>{current ? '目前資產' : point.date.replaceAll('-', '/')}</h2></div>
          <div className="row">
            {!current && <button onClick={() => setSelected('current')}>回到目前</button>}
            {onCommitHistory && <>
              <button disabled={locked} onClick={() => setEditing({ date: point.date, expected: data.history.quantityDays?.find(d => d.date === point.date) })}>編輯這天</button>
              <button disabled={locked} onClick={() => setEditing({ date: live.date })}>補登日期</button>
              {!current && point.manual && <button disabled={locked} onClick={() => {
                if (confirm(removalMessage(data, point.date))) commit({ ...data, history: { ...data.history, quantityDays: data.history.quantityDays?.filter(d => d.date !== point.date) } })
              }}>移除這天補登</button>}
              {undo && data.history.quantityDays === undo.after.quantityDays && data.history.holdingPeriods === undo.after.holdingPeriods && <button disabled={locked} onClick={() => { onCommitHistory({ ...data, history: { ...data.history, quantityDays: undo.before.quantityDays, holdingPeriods: undo.before.holdingPeriods } }); setUndo(undefined) }}>復原上次歷史修改</button>}
            </>}
          </div>
        </div>
        {dirty && <p className="notice">請先儲存或捨棄其他未儲存修改，再編輯歷史。</p>}
        {busy && <p className="muted" role="status">背景儲存或更新中，完成後即可編輯歷史。</p>}
        <div className="segmented" role="group" aria-label="顯示方式">{(Object.keys(MODES) as Mode[]).map(m => <button key={m} aria-pressed={m === mode} className={m === mode ? 'on' : ''} onClick={() => setMode(m)}>{MODES[m]}</button>)}</div>
        <TrendChart dates={chartPoints.map(p => p.date)} series={seriesFor(mode, chartPoints, accountNames)} area={mode === 'total'} />
        <div className="timeline-controls">
          <input type="range" aria-label="資產快照時間線" aria-valuetext={current ? '目前資產' : point.date} min={0} max={points.length - 1} step={1} value={index} onChange={e => setSelected(keys[Number(e.target.value)])} />
          <label className="field"><span>選擇時間節點</span><select value={keys[index]} onChange={e => setSelected(e.target.value)}>{points.map((p, i) => <option key={keys[i]} value={keys[i]}>{keys[i] === 'current' ? '目前資產' : `${p.date}${p.periodDerived ? ' · 期間推算' : p.manual ? ' · 補登' : ''}`}</option>)}</select></label>
        </div>
        <p className="muted small">拖動滑桿或選擇紀錄，查看當時的餘額與配置。原始快照保留原值；期間推算補上缺少快照的日期，單日補登優先。</p>
        {!!(data.history.quantityDays?.length || data.history.holdingPeriods?.length) && <button className="link" disabled={historical.loading} onClick={historical.refresh}>{historical.loading ? '查詢歷史行情中…' : '重新查詢歷史行情'}</button>}
        {historical.omittedDays > 0 && <p className="muted small">略過 {historical.omittedDays} 個數量不足的推算日，不代表資產為零。</p>}
        {historical.status && <p className="muted small" aria-live="polite">{historical.status}</p>}
        {historical.error && <p role="alert" className="banner error">{historical.error}</p>}
      </section>
      {editing && onCommitHistory && <QuantityEditor key={editing.date} data={data} busy={locked} date={editing.date} expected={editing.expected}
        onCancel={() => setEditing(undefined)} onApply={next => {
          const changed = next.history.quantityDays?.find(d => !data.history.quantityDays?.includes(d))
          commit(next)
          if (changed) setSelected(changed.date)
          setEditing(undefined)
        }} />}
      {!current ? <SnapshotDetails point={point} day={historical.data.history.valuedQuantityDays?.find(d => d.date === point.date)} /> : <>
      <section className="panel hero">
        <span className="eyebrow">總資產</span>
        <div className="hero-figure">
          <small>NT$</small>
          {fmt(byCategory.total, 0)}
        </div>
        <ChangeSinceLast data={historical.data} />
        <p className="muted">
          {data.accounts.length} 個帳戶
          {data.fxUpdatedAt && ` · 匯率更新於 ${new Date(data.fxUpdatedAt).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}`}
        </p>
        {missing.length > 0 && (
          <p className="notice">
            <span aria-hidden>⚠</span> {missing.join('、')} 沒有匯率；資產總額可能不完整，相關負債與淨資產暫不換算。
            <button className="link" onClick={onGoRates}>
              查看匯率
            </button>
          </p>
        )}
      </section>

      <section className="panel stat" aria-label="總負債">
        <span className="eyebrow">{estimated ? '總負債（含預估）' : '總負債'}</span><strong>{totals.liabilities === null ? '尚無法換算' : `NT$ ${fmt(totals.liabilities, 0)}`}</strong>
        <span className="muted small">{data.liabilities?.length ?? 0} 筆{estimated ? ' · 假設按期還款；不代表銀行餘額，不會扣除現金' : '手動記錄'}</span>
        {onGoLiabilities && <button className="link" onClick={onGoLiabilities}>管理負債</button>}
      </section>
      <section className="panel stat" aria-label="淨資產">
        <span className="eyebrow">{estimated ? '淨資產（預估）' : '淨資產'}</span><strong>{totals.net === null ? '尚無法換算' : `NT$ ${fmt(totals.net, 0)}`}</strong>
        <span className="muted small">總資產 − 總負債{totals.net === null ? ' · 請檢查匯率' : ''}</span>
      </section>
      {!data.accounts.length && <section className="panel span-2"><p className="muted">尚未記錄資產，目前總資產為 0。</p><button onClick={onNewAccount}>新增資產帳戶</button></section>}
      {data.accounts.length > 0 && <>

      <section className="panel span-2">
        <h3>資產配置</h3>
        <Allocation slices={colorize(byCategory.slices, CATEGORIES)} />
      </section>

      <section className="panel">
        <h3>帳戶</h3>
        <RankBars slices={breakdown(data, (a) => a.name).slices} onSelect={onOpenAccount} />
      </section>

      <section className="panel">
        <h3>幣別曝險</h3>
        <Allocation slices={colorize(breakdown(data, (_, p) => p.currency).slices, COMMON_CURRENCIES)} />
      </section>

      {data.accounts.some((a) => a.country) && (
        <section className="panel">
          <h3>國家</h3>
          <Allocation
            slices={colorize(
              breakdown(data, (a) => (a.country ? countryLabel(a.country) : '')).slices,
              Object.values(COUNTRIES),
            )}
          />
        </section>
      )}
      </>}
      </>}
      {onCommitHistory && <details className="panel span-2"><summary>歷史管理與異動紀錄</summary>
        <HistoryView embedded data={data} dirty={dirty} busy={locked} onSave={onSave ?? (() => {})} onChange={commit} onOpenAccount={id => { const account = data.accounts.find(a => a.id === id); if (account) onOpenAccount(account.name) }} />
      </details>}
    </div>
  )
}

