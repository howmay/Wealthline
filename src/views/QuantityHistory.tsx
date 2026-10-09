import { useEffect, useRef, useState } from 'react'
import { applyHoldingPeriod, expandPeriodDays, periodConflicts, periodQuantityOn, periodRevision, shiftDate, type HoldingPeriod } from '../holdingPeriods'
import type { WealthData } from '../model'
import { localDate } from '../history'
import { applyQuantityDay, entriesForDate, entryValue, historyCatalog, instrumentKey, parseQuantityDays, quantityPoint, validatePastDate, valueDays, valueEntries, type QuantityDay, type QuantityEntry } from '../quantityHistory'
import { HistoryBaseline } from './HistoryBaseline'
import { HistoricalFxValue } from './HistoricalFxValue'
import { fmt } from '../format'

export interface QuantityEditRequest { mode?:'baseline'; date: string; expected?: QuantityDay; entryKey?: string }
const nameOf = (e: QuantityEntry) => `${e.account} · ${e.symbol || e.currency} · ${e.currency}`
const stamp = () => new Date().toISOString()

export function QuantityHistory({ data, onChange, request: editing, onRequest: setEditing, displayDays }: {
  data: WealthData; onChange: (d: WealthData) => void; displayDays?: QuantityDay[];
  request?: QuantityEditRequest; onRequest: (request: QuantityEditRequest | undefined) => void;
}) {
  const [undo, setUndo] = useState<{ before: {days?:QuantityDay[];periods?:HoldingPeriod[]}; after: {days?:QuantityDay[];periods?:HoldingPeriod[]} } | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const days = data.history.quantityDays ?? []
  const apply = (next: WealthData) => { setUndo({ before:{days:data.history.quantityDays,periods:data.history.holdingPeriods}, after:{days:next.history.quantityDays,periods:next.history.holdingPeriods} }); onChange(next) }
  const accounts = [...new Map(days.flatMap(d => d.entries.map(e => [e.accountId, e.account] as const))).entries()]
  const activeFilter = accounts.some(([id]) => id === filter) ? filter : ''
  return <section className="panel quantity-panel" aria-label="歷史持倉數量">
    <div className="panel-head"><h3>歷史持倉數量</h3>{!editing && <div className="history-entry-actions"><button onClick={() => setEditing({ date: localDate(stamp()) })}>＋ 補登歷史數量</button><button onClick={()=>setEditing({date:'',mode:'baseline'})}>沿用持倉回補差異</button></div>}</div>
    <p className="muted small">補登單日或持有期間；修改既有紀錄可從日期列直接選項目。所有操作只影響歷史數量。</p>
    {days.some(d=>d.entries.some(e=>e.quantity===null)) && <p className="notice">既有未知數量會保留並中斷對應持有期間。舊資料無法判別佔位或刻意清除，請逐項核對，不會自動移除。</p>}
    {error && <p role="alert" className="banner error">{error}</p>}
    {editing?.mode==='baseline' ? <HistoryBaseline data={data} onCancel={()=>setEditing(undefined)} onApply={next=>{apply(next);setEditing(undefined)}}/> : editing ? <QuantityEditor key={`${editing.date}:${editing.entryKey ?? ''}`} data={data} date={editing.date} expected={editing.expected} entryKey={editing.entryKey}
      onCancel={() => setEditing(undefined)} onApply={next => { apply(next); setEditing(undefined) }} /> : <>
      {undo && <button onClick={() => {
        if ((data.history.quantityDays !== undo.after.days || data.history.holdingPeriods !== undo.after.periods)) { setError('歷史已變更，無法直接復原；請重新檢查。'); return }
        onChange({ ...data, history: { ...data.history, quantityDays: undo.before.days ?? [], holdingPeriods: undo.before.periods } }); setUndo(null)
      }}>復原上次歷史修改</button>}
      {(data.history.holdingPeriods ?? []).map(period => <details className="quantity-day" key={period.id}>
        <summary>{period.start} → {period.end ?? '持續持有'} · {period.symbol || period.currency}</summary>
        <p>{period.account} · {period.currency} · 數量 {fmt(period.quantity,8)}</p>
        <p className="muted small">開始日含、結束／賣出日不含；日曆時區 {period.timeZone}。明確數量紀錄及較晚開始的期間優先。</p>
        <button className="danger" onClick={() => { if(confirm('移除此持有期間？會依其他期間與單日紀錄重新估算，目前持倉不變。')) apply({...data,history:{...data.history,holdingPeriods:data.history.holdingPeriods?.filter(p=>p.id!==period.id)}}) }}>移除期間 {period.start}</button>
      </details>)}
      {!days.length ? <p className="muted">尚未單日補登。舊每日快照只有總額，無法還原各持倉數量。</p> : <label className="field"><span>篩選已補登帳戶</span><select value={activeFilter} onChange={e => setFilter(e.target.value)}><option value="">全部帳戶</option>{accounts.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
      {[...days].reverse().filter(day => !activeFilter || day.entries.some(e => e.accountId === activeFilter)).map(day => <details className="quantity-day" key={day.date}>
        <summary>{day.date}{day.inventory ? ' · 完整回補' : ''} · {day.entries.filter(e => (!activeFilter || e.accountId === activeFilter) && e.quantity !== null).length} 項已填數量</summary>
        <div className="quantity-rows">{(displayDays?.find(d => d.date === day.date)?.entries ?? day.entries).filter(e => !activeFilter || e.accountId === activeFilter).map(entry => <div className="quantity-row" key={instrumentKey(entry)}>
          <strong>{nameOf(entry)}</strong><span>數量 {entry.quantity === null ? '未知' : fmt(entry.quantity, 8)}</span><Valuation entry={entry} />
          <button aria-label={`編輯 ${day.date} ${nameOf(entry)}`} onClick={() => setEditing({ date: day.date, expected: day, entryKey: instrumentKey(entry) })}>編輯這項數量</button>
        </div>)}</div>
        <div className="row"><button onClick={() => setEditing({ date: day.date, expected: day })}>編輯 {day.date}</button><button className="danger" onClick={() => {
          if (confirm(`移除 ${day.date} 的手動補登？會恢復原快照（若存在），目前持倉不變。`)) apply({ ...data, history: { ...data.history, quantityDays: days.filter(d => d !== day) } })
        }}>移除 {day.date}</button></div>
      </details>)}
    </>}
  </section>
}

export function QuantityEditor({ data, date: initialDate, expected, entryKey, onCancel, onApply }: {
  data: WealthData; date: string; expected?: QuantityDay; entryKey?: string; onCancel: () => void; onApply: (data: WealthData) => void;
}) {
  const catalog = historyCatalog(data)
  const editEntries = expected?.entries ?? []
  const editingDay = !!expected
  const initialKey = entryKey ?? (editEntries.length === 1 ? instrumentKey(editEntries[0]) : '')
  const initial = editingDay ? editEntries.find(e => instrumentKey(e) === initialKey) : catalog.find(e => instrumentKey(e) === initialKey)
  const [step, setStep] = useState(initial ? 2 : editingDay ? -1 : 0)
  const [accountId, setAccountId] = useState(initial?.accountId ?? '')
  const [selectedKey, setSelectedKey] = useState(initialKey)
  const [date, setDate] = useState(initialDate)
  const [mode,setMode] = useState<'day'|'period'>('day')
  const [end,setEnd] = useState('')
  const [timeZone,setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [periodPreview,setPeriodPreview] = useState<{period:HoldingPeriod;revision:string;conflicts:string[];days:QuantityDay[];before:WealthData}|null>(null)
  const [confirmed,setConfirmed] = useState(false)
  const [quantity, setQuantity] = useState(() => initial ? entriesForDate(data,initialDate).find(e => instrumentKey(e) === initialKey)?.quantity?.toString() ?? '' : '')
  const [symbol, setSymbol] = useState('')
  const [currency, setCurrency] = useState('TWD')
  const [type, setType] = useState<'holding' | 'cash'>('holding')
  const [preview, setPreview] = useState<QuantityDay | null>(null)
  const [total, setTotal] = useState<number|null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const baseline = useRef(expected ?? data.history.quantityDays?.find(d => d.date === initialDate))
  const latest = useRef(data)
  const revision = useRef(0)
  const live = useRef(true)
  const editor = useRef<HTMLDivElement>(null)
  useEffect(() => { latest.current = data }, [data])
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  useEffect(() => { editor.current?.scrollIntoView?.({ block: 'start' }); editor.current?.querySelector<HTMLElement>('h4')?.focus() }, [step])
  const accounts = new Map(catalog.map(e => [e.accountId, { id:e.accountId, name:e.account, category:e.category, country:e.country }]))
  for (const a of data.accounts) accounts.set(a.id,a)
  const account = accounts.get(accountId)
  const choices = (editingDay ? editEntries : catalog).filter(e => e.accountId === accountId)
  const selected = selectedKey === '__new__' && account ? { accountId, account:account.name, category:account.category, country:account.country, type, symbol:type === 'cash' ? '' : symbol.trim().toUpperCase(), currency:currency.trim().toUpperCase() } : choices.find(e => instrumentKey(e) === selectedKey)
  const existingEntry = editEntries.find(e => instrumentKey(e) === selectedKey)
  const resetPreview = () => { revision.current++; setLoading(false); setPreview(null); setPeriodPreview(null); setConfirmed(false); setError('') }
  const loadQuantity = (key: string, onDate = date) => setQuantity(entriesForDate(latest.current,onDate).find(e => instrumentKey(e) === key)?.quantity?.toString() ?? '')
  const chooseAccount = (id: string) => { resetPreview(); setAccountId(id); setSelectedKey(''); setQuantity(''); setSymbol(''); setCurrency('TWD'); setType('holding') }
  const chooseInstrument = (key: string) => { resetPreview(); setSelectedKey(key); loadQuantity(key); setTimeZone(latest.current.history.holdingPeriods?.find(p=>instrumentKey(p)===key)?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone) }
  const goToQuantity = () => {
    try {
      if (!selected) throw new Error('請先選擇標的')
      parseQuantityDays([{ date:localDate(stamp()), updatedAt:stamp(), entries:[{ ...selected, quantity:null }] }])
      if (selectedKey === '__new__' && choices.some(e => instrumentKey(e) === instrumentKey(selected))) { setSelectedKey(instrumentKey(selected)); loadQuantity(instrumentKey(selected)) }
      resetPreview(); setStep(2)
    } catch (e) { setError(e instanceof Error ? e.message : '請檢查標的資料') }
  }
  const changeDate = (value: string) => {
    resetPreview(); setDate(value); baseline.current = latest.current.history.quantityDays?.find(d => d.date === value)
    loadQuantity(selected ? instrumentKey(selected) : '',value)
  }
  const prepare = async () => {
    resetPreview(); const request = revision.current
    try {
      if (mode==='day') validatePastDate(date)
      if (!selected) throw new Error('請重新選擇帳戶與標的')
      if (mode==='period') {
        if(!quantity.trim()) throw new Error('持有期間請填寫絕對數量；單日模式才可留空表示未知')
        const before=latest.current, fingerprint=periodRevision(before)
        const period:HoldingPeriod={...selected,id:crypto.randomUUID(),updatedAt:stamp(),start:date,...(end && {end}),quantity:Number(quantity),timeZone}
        const candidate=applyHoldingPeriod(before,period,fingerprint,true)
        setLoading(true)
        const days=await valueDays(expandPeriodDays(candidate))
        if(live.current && request===revision.current) { setPeriodPreview({period,revision:fingerprint,conflicts:periodConflicts(before,period),days,before}); setStep(3) }
        return
      }
      if (latest.current.history.quantityDays?.find(d => d.date === date) !== baseline.current) throw new Error('這一天已變更，請取消並重新開啟，避免覆蓋其他修改')
      const entry: QuantityEntry = { ...selected, quantity:quantity.trim() ? Number(quantity) : null }
      const existing = latest.current.history.quantityDays?.find(d=>d.date===date)?.entries ?? []
      const rows = existing.some(e=>instrumentKey(e)===instrumentKey(entry)) ? existing.map(e=>instrumentKey(e)===instrumentKey(entry) ? entry : e) : [...existing,entry]
      const candidate = { date, updatedAt:stamp(), entries:rows, ...(baseline.current?.inventory ? {inventory:baseline.current.inventory} : {sparse:true as const}) }
      parseQuantityDays([candidate]); setLoading(true)
      const projectedData={...latest.current,history:{...latest.current.history,quantityDays:[...(latest.current.history.quantityDays ?? []).filter(d=>d.date!==date),candidate]}}
      const projected=expandPeriodDays(projectedData).find(d=>d.date===date) ?? candidate
      const entries = await valueEntries(projected.entries,date)
      if (live.current && revision.current === request) {
        setTotal(quantityPoint({...candidate,entries},latest.current.history.snapshots.find(s=>s.date===date)).total)
        // Query the complete preview, but persist changes only to the chosen target.
        setPreview({...candidate,entries:rows.map(row=>instrumentKey(row)===instrumentKey(entry) ? entries.find(e=>instrumentKey(e)===instrumentKey(entry))! : row)});setStep(3)
      }
    } catch (e) { if (live.current && revision.current === request) setError(e instanceof Error ? e.message : '無法取得歷史行情') }
    finally { if (live.current && revision.current === request) setLoading(false) }
  }
  const completeDay=!!data.history.quantityDays?.find(d=>d.date===date)?.inventory
  const active = preview?.entries.find(e => selected && instrumentKey(e) === instrumentKey(selected))
  const steps = ['選帳戶','選標的','日期與數量','預覽確認']
  return <div ref={editor} className="quantity-editor form" role="region" aria-label="編輯歷史數量" onKeyDown={e => { if(e.key==='Escape') { e.stopPropagation(); revision.current++; onCancel() } }}>
    <p className="eyebrow">{editingDay ? `編輯 ${initialDate} · ${step===-1 ? '選擇項目' : step===2 ? '修改數量' : '確認修改'}` : `新增補登 · 步驟 ${step + 1}／4`}</p><h4 tabIndex={-1}>{step===-1 ? '選擇要修改的項目' : editingDay && step===2 ? '修改當日數量' : steps[step]}</h4>
    {step===-1 && <>
      <p className="muted small">這天有 {editEntries.length} 項紀錄。選擇一項修改，其餘資料保留。</p>
      <div className="history-item-choices">{editEntries.map(entry=><button key={instrumentKey(entry)} onClick={()=>{ resetPreview(); setAccountId(entry.accountId); setSelectedKey(instrumentKey(entry)); setQuantity(entry.quantity?.toString() ?? ''); setStep(2) }}>
        <strong>{entry.account}</strong><span>{entry.type==='cash' ? '現金餘額' : entry.symbol} · {entry.currency}</span><span>既有數量：{entry.quantity===null ? '未知' : fmt(entry.quantity,8)}</span>
      </button>)}</div>
      {!editEntries.length && <p className="notice">這天沒有可修改的項目，請取消後使用「補登歷史數量」。</p>}
    </>}
    {step > 0 && account && <p className="quantity-selection">{existingEntry?.account ?? account.name}{step > 1 && selected && <><br />{selected.type==='cash' ? '現金餘額' : selected.symbol} · {selected.currency}</>}</p>}
    {step === 0 && <>
      <label className="field"><span>補登帳戶</span><select value={accountId} onChange={e => chooseAccount(e.target.value)}><option value="">請選擇帳戶</option>{[...accounts.values()].map(a => <option key={a.id} value={a.id}>{a.name}{data.accounts.some(x => x.id === a.id) ? '' : '（歷史帳戶）'}</option>)}</select></label>
      {!accounts.size && <p className="notice">目前沒有可補登的帳戶，請先到「帳戶」建立一個帳戶。</p>}
    </>}
    {step === 1 && <>
      <label className="field"><span>補登標的</span><select value={selectedKey} onChange={e => chooseInstrument(e.target.value)}><option value="">請選擇標的</option>{choices.map(e => <option key={instrumentKey(e)} value={instrumentKey(e)}>{e.type === 'cash' ? '現金餘額' : e.symbol} · {e.currency}</option>)}<option value="__new__">其他／已移除的標的</option></select></label>
      {!choices.length && <p className="notice">此帳戶目前沒有持倉，可選「其他／已移除的標的」補登。</p>}
      {selectedKey === '__new__' && <>
        <label className="field"><span>歷史持倉類型</span><select value={type} onChange={e => { resetPreview(); setType(e.target.value as typeof type) }}><option value="holding">持倉</option><option value="cash">現金</option></select></label>
        {type === 'holding' && <label className="field"><span>歷史標的代號</span><input value={symbol} onChange={e => { resetPreview(); setSymbol(e.target.value) }} /></label>}
        <label className="field"><span>歷史持倉幣別</span><input value={currency} onChange={e => { resetPreview(); setCurrency(e.target.value) }} /></label>
        <p className="muted small">只補登歷史，不新增目前持倉；沒有市場行情時保留數量，估值為未知。</p>
      </>}
    </>}
    {step === 2 && selected && <>
      {!editingDay && <label className="field"><span>補登方式</span><select value={mode} onChange={e=>{resetPreview();setMode(e.target.value as typeof mode)}}><option value="day">單日數量</option><option value="period">持有期間</option></select></label>}
      <label className="field"><span>{mode==='period' ? '開始日期（含）' : '歷史日期'}</span><input type="date" max={mode==='day' ? localDate(stamp()) : undefined} disabled={mode==='day' && !!expected} value={date} onChange={e => changeDate(e.target.value)} /></label>
      {mode==='period' && <>
        <label className="field"><span>結束／賣出日期（不含，選填）</span><input type="date" value={end} onChange={e=>{resetPreview();setEnd(e.target.value)}} /></label>
        <p className="muted small">例如 9/1 買入、10/2 全部賣出：9/1–10/1 持有，10/2 收盤為 0；後續再買紀錄優先。空白表示持續持有的歷史基準，不能覆蓋目前實際持倉。</p>
        <details><summary>期間日曆時區：{timeZone}</summary><label className="field"><span>期間日曆時區</span><input value={timeZone} onChange={e=>{resetPreview();setTimeZone(e.target.value)}} /></label></details>
      </>}
      {existingEntry && <p className="history-original">既有數量：{existingEntry.quantity===null ? '未知' : fmt(existingEntry.quantity,8)} · 只修改 {initialDate}，目前持倉不變。</p>}
      <label className="field"><span>{mode==='period' ? '期間基準數量' : '當日絕對數量'}</span><input aria-label={`${nameOf({ ...selected,quantity:null })} 當日數量`} inputMode="decimal" value={quantity} onChange={e => { resetPreview(); setQuantity(e.target.value) }} /></label>
      <p className="muted small">填該日的絕對總數量，不是增減量。0 為確定未持有；同帳戶、同標的、同幣別合計所有批次。{completeDay ? '完整清單須保留已知數量，不能留空。' : '空白為未知。'}</p>
      {mode==='day' && !completeDay && <button onClick={() => { resetPreview(); setQuantity('') }}>清除數量（未知）</button>}
    </>}
    {step === 3 && active && <>
      <p><strong>{date}</strong> · 數量 {active.quantity === null ? '未知' : fmt(active.quantity,8)}</p><Valuation entry={active} />
      <p className="notice" role="status">當日總資產：{total === null ? '資料不完整，圖表顯示缺口' : `NT$ ${fmt(total,2)}`}。只修改選定項目；同日其他已填數量保留，未填項目維持未知。</p>
      <p className="muted small">價格與匯率只取市場來源；不使用手填歷史價。負債沿用當日紀錄，沒有紀錄時保持未知。</p>
    </>}
    {step===3 && periodPreview && <>
      <p><strong>{periodPreview.period.start} 至 {periodPreview.period.end ?? '持續持有'}</strong> · 基準數量 {fmt(periodPreview.period.quantity,8)}</p>
      <p className="notice" role="status">期間預覽：{periodPreview.days.length} 個日期；{periodPreview.days.filter(d=>quantityPoint(d).total===null).length} 日資料不完整。開始含、結束不含；只重建已結束日，今天仍顯示目前持倉。近十年逐日使用市場價格與匯率。已有原始快照保留原值；需要修正該日請使用單日補登。</p>
      <p className="muted small">較晚開始的期間接手後，舊期間不會恢復；單日及數量異動在同日優先，持續到下一個明確基準。期間內的加減碼請分段或保留明確數量紀錄。</p>
      <ul className="period-preview">{periodPreview.days.filter(d=>[periodPreview.period.start,periodPreview.period.end,periodPreview.period.end ? shiftDate(periodPreview.period.end,-1):'',periodPreview.days.at(-1)?.date].includes(d.date)).map(day=>{
        const entry=day.entries.find(e=>instrumentKey(e)===instrumentKey(periodPreview.period))!
        const old=periodQuantityOn(periodPreview.before,periodPreview.period,day.date)?.quantity ?? entriesForDate(periodPreview.before,day.date).find(e=>instrumentKey(e)===instrumentKey(periodPreview.period))?.quantity
        return <li key={day.date}><strong>{day.date}</strong><p>數量 {old ?? '未知'} → {entry.quantity ?? '未知'}</p><Valuation entry={entry}/></li>
      })}</ul>
      {!!periodPreview.conflicts.length && <><details open><summary>需確認的重疊／明確紀錄（{periodPreview.conflicts.length}）</summary><ul>{periodPreview.conflicts.map((message,i)=><li key={i}>{message}</li>)}</ul></details><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> 我已核對差異，同意依上述優先順序套用；原紀錄保留。</label></>}
    </>}
    {error && <p role="alert" className="banner error">{error}</p>}
    <div className="quantity-actions">
      {step === 0 && <button className="primary" disabled={!account} onClick={() => setStep(1)}>下一步：選標的</button>}
      {step === 1 && <button className="primary" disabled={!selected} onClick={goToQuantity}>下一步：填數量</button>}
      {step === 2 && <button className="primary" disabled={loading} onClick={() => void prepare()}>{loading ? '取得歷史行情中…' : '取得歷史估值'}</button>}
      {step === 3 && <button className="primary" onClick={() => { try { if(periodPreview) onApply(applyHoldingPeriod(latest.current,periodPreview.period,periodPreview.revision,confirmed)); else if (preview) onApply(applyQuantityDay(latest.current,preview,baseline.current)) } catch (e) { setError(e instanceof Error ? e.message : '無法套用') } }}>套用歷史數量</button>}
      {step > 0 && (!editingDay || step===3 || editEntries.length>1) && <button onClick={() => { resetPreview(); setStep(editingDay && step===2 ? -1 : step - 1) }}>{step === 3 ? '返回修改' : editingDay ? '改選其他項目' : '上一步'}</button>}
      <button onClick={() => { revision.current++; onCancel() }}>取消歷史編輯</button>
    </div>
    <p className="muted small">套用後仍需「儲存變更」才會寫入 Drive。</p>
  </div>
}

function Valuation({ entry: e }: { entry: QuantityEntry }) {
  const value = entryValue(e)
  const price = e.price?.source === 'Yahoo' ? `Yahoo ${e.price.symbol} · ${e.price.date} 收盤 ${fmt(e.price.value, 6)} ${e.currency}` : undefined
  return (
    <div className="small">
      <span>{value === null ? '估值未知' : `NT$ ${fmt(value, 2)}`}</span>
      {e.quantity !== null && e.quantity !== 0 && (
        <>
          <div>{e.type === 'cash' ? '單位值 1' : (price ?? '缺歷史收盤價')}</div>
          <div>{e.currency === 'TWD' ? 'TWD 匯率 1' : e.fx ? <HistoricalFxValue quote={e.fx}/> : '缺歷史匯率'}</div>
        </>
      )}
      {e.error && <p className="notice">{e.error}</p>}
    </div>
  )
}
