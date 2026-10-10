import { useCalendarNow } from '../useCalendarNow'
import { useState } from 'react'
import type { HistoricalPoint } from '../quantityHistory'
import { snapshotOf, totalPoints } from '../history'
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
  onCommitHistory?: (data: WealthData) => void
  onGoRates: () => void
  onGoLiabilities?: () => void
  onNewAccount: () => void
  onImport: () => void
  onOpenAccount: (name: string) => void
}

export function Overview({ data, busy = false, onCommitHistory, onGoRates, onGoLiabilities, onNewAccount, onImport, onOpenAccount }: Props) {
  const now = useCalendarNow()
  const estimated = data.liabilities?.some(d => d.schedule)
  const historical = useHistoricalValuations(data)
  const [selected, setSelected] = useState('current')
  const [editing, setEditing] = useState<QuantityEditRequest>()
  const [undo, setUndo] = useState<{ before: WealthData['history']; after: WealthData['history'] }>()
  const commit = (next: WealthData) => {
    setUndo({ before: data.history, after: next.history })
    onCommitHistory?.(next)
  }
  const live = snapshotOf(data, now)
  const points: HistoricalPoint[] = [...totalPoints(historical.data, now).filter(p => p.date !== live.date || p.manual), live]
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
              <button disabled={busy} onClick={() => setEditing({ date: point.date, expected: data.history.quantityDays?.find(d => d.date === point.date) })}>編輯這天</button>
              <button disabled={busy} onClick={() => setEditing({ date: live.date })}>補登日期</button>
              {!current && point.manual && <button disabled={busy} onClick={() => {
                if (confirm(`移除 ${point.date} 的補登紀錄？`)) commit({ ...data, history: { ...data.history, quantityDays: data.history.quantityDays?.filter(d => d.date !== point.date) } })
              }}>移除這天補登</button>}
              {undo && data.history.quantityDays === undo.after.quantityDays && <button disabled={busy} onClick={() => { onCommitHistory({ ...data, history: { ...data.history, quantityDays: undo.before.quantityDays } }); setUndo(undefined) }}>復原上次歷史修改</button>}
            </>}
          </div>
        </div>
        <TrendChart dates={points.map(p => p.date)} series={[{ key: 'total', label: '總資產', color: 'var(--s1)', values: points.map(p => p.total) }]} area />
        <div className="timeline-controls">
          <input type="range" aria-label="資產快照時間線" aria-valuetext={current ? '目前資產' : point.date} min={0} max={points.length - 1} step={1} value={index} onChange={e => setSelected(keys[Number(e.target.value)])} />
          <label className="field"><span>選擇時間節點</span><select value={keys[index]} onChange={e => setSelected(e.target.value)}>{points.map((p, i) => <option key={keys[i]} value={keys[i]}>{keys[i] === 'current' ? '目前資產' : `${p.date}${p.manual ? ' · 補登' : ''}`}</option>)}</select></label>
        </div>
        <p className="muted small">拖動滑桿或選擇紀錄，查看當時的餘額與配置。沒有紀錄的日期不補值。</p>
        {!!data.history.quantityDays?.length && <button className="link" disabled={historical.loading} onClick={historical.refresh}>{historical.loading ? '查詢歷史行情中…' : '重新查詢歷史行情'}</button>}
      </section>
      {editing && onCommitHistory && <QuantityEditor key={editing.date} data={data} date={editing.date} expected={editing.expected}
        onCancel={() => setEditing(undefined)} onApply={next => {
          const changed = next.history.quantityDays?.find(d => !data.history.quantityDays?.includes(d))
          if (changed) setSelected(changed.date)
          commit(next)
          setEditing(undefined)
        }} />}
      {!current ? <SnapshotDetails point={point} day={historical.data.history.quantityDays?.find(d => d.date === point.date)} /> : <>
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
    </div>
  )
}

