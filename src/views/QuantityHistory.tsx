import { useEffect, useRef, useState } from 'react'
import type { WealthData } from '../model'
import { localDate } from '../history'
import { applyQuantityDay, entriesForDate, entryValue, historyCatalog, instrumentKey, parseQuantityDays, quantityPoint, validatePastDate, valueEntries, type QuantityDay, type QuantityEntry } from '../quantityHistory'
import { fmt } from '../format'

export interface QuantityEditRequest { date: string; expected?: QuantityDay; entryKey?: string }
const nameOf = (e: QuantityEntry) => `${e.account} · ${e.symbol || e.currency} · ${e.currency}`
const stamp = () => new Date().toISOString()

export function QuantityHistory({ data, onChange, request: editing, onRequest: setEditing, displayDays }: {
  data: WealthData; onChange: (d: WealthData) => void; displayDays?: QuantityDay[];
  request?: QuantityEditRequest; onRequest: (request: QuantityEditRequest | undefined) => void;
}) {
  const [undo, setUndo] = useState<{ before: QuantityDay[] | undefined; after: QuantityDay[] } | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const days = data.history.quantityDays ?? []
  const apply = (next: WealthData) => { setUndo({ before: data.history.quantityDays, after: next.history.quantityDays! }); onChange(next) }
  const accounts = [...new Map(days.flatMap(d => d.entries.map(e => [e.accountId, e.account] as const))).entries()]
  const activeFilter = accounts.some(([id]) => id === filter) ? filter : ''
  return <section className="panel quantity-panel" aria-label="歷史持倉數量">
    <div className="panel-head"><h3>歷史持倉數量</h3>{!editing && <button onClick={() => setEditing({ date: localDate(stamp()) })}>＋ 補登歷史數量</button>}</div>
    <p className="muted small">先選帳戶與標的，再填當日的絕對持有數量。同帳戶、同標的、同幣別合計多批次；不修改目前持倉。</p>
    {error && <p role="alert" className="banner error">{error}</p>}
    {editing ? <QuantityEditor key={`${editing.date}:${editing.entryKey ?? ''}`} data={data} date={editing.date} expected={editing.expected} entryKey={editing.entryKey}
      onCancel={() => setEditing(undefined)} onApply={next => { apply(next); setEditing(undefined) }} /> : <>
      {undo && <button onClick={() => {
        if (data.history.quantityDays !== undo.after) { setError('歷史已變更，無法直接復原；請重新檢查。'); return }
        onChange({ ...data, history: { ...data.history, quantityDays: undo.before ?? [] } }); setUndo(null)
      }}>復原上次歷史修改</button>}
      {!days.length ? <p className="muted">尚未手動補登。舊每日快照只有總額，無法還原各持倉數量。</p> : <label className="field"><span>篩選已補登帳戶</span><select value={activeFilter} onChange={e => setFilter(e.target.value)}><option value="">全部帳戶</option>{accounts.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
      {[...days].reverse().filter(day => !activeFilter || day.entries.some(e => e.accountId === activeFilter)).map(day => <details className="quantity-day" key={day.date}>
        <summary>{day.date} · {day.entries.filter(e => (!activeFilter || e.accountId === activeFilter) && e.quantity !== null).length} 項已填數量</summary>
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
  const initial = entryKey ? catalog.find(e => instrumentKey(e) === entryKey) : undefined
  const [step, setStep] = useState(initial ? 2 : 0)
  const [accountId, setAccountId] = useState(initial?.accountId ?? '')
  const [selectedKey, setSelectedKey] = useState(entryKey ?? '')
  const [date, setDate] = useState(initialDate)
  const [quantity, setQuantity] = useState(() => initial ? entriesForDate(data,initialDate).find(e => instrumentKey(e) === entryKey)?.quantity?.toString() ?? '' : '')
  const [symbol, setSymbol] = useState('')
  const [currency, setCurrency] = useState('TWD')
  const [type, setType] = useState<'holding' | 'cash'>('holding')
  const [preview, setPreview] = useState<QuantityDay | null>(null)
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
  const choices = catalog.filter(e => e.accountId === accountId)
  const selected = selectedKey === '__new__' && account ? { accountId, account:account.name, category:account.category, country:account.country, type, symbol:type === 'cash' ? '' : symbol.trim().toUpperCase(), currency:currency.trim().toUpperCase() } : choices.find(e => instrumentKey(e) === selectedKey)
  const resetPreview = () => { revision.current++; setLoading(false); setPreview(null); setError('') }
  const loadQuantity = (key: string, onDate = date) => setQuantity(entriesForDate(latest.current,onDate).find(e => instrumentKey(e) === key)?.quantity?.toString() ?? '')
  const chooseAccount = (id: string) => { resetPreview(); setAccountId(id); setSelectedKey(''); setQuantity(''); setSymbol(''); setCurrency('TWD'); setType('holding') }
  const chooseInstrument = (key: string) => { resetPreview(); setSelectedKey(key); loadQuantity(key) }
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
      validatePastDate(date)
      if (!selected) throw new Error('請重新選擇帳戶與標的')
      if (latest.current.history.quantityDays?.find(d => d.date === date) !== baseline.current) throw new Error('這一天已變更，請取消並重新開啟，避免覆蓋其他修改')
      const entry: QuantityEntry = { ...selected, quantity:quantity.trim() ? Number(quantity) : null }
      const others = entriesForDate(latest.current,date).filter(e => instrumentKey(e) !== instrumentKey(entry))
      const rows = [...others,entry]
      const candidate = { date, updatedAt:stamp(), entries:rows }
      parseQuantityDays([candidate]); setLoading(true)
      const entries = await valueEntries(rows,date)
      if (live.current && revision.current === request) { setPreview({ ...candidate,entries }); setStep(3) }
    } catch (e) { if (live.current && revision.current === request) setError(e instanceof Error ? e.message : '無法取得歷史行情') }
    finally { if (live.current && revision.current === request) setLoading(false) }
  }
  const active = preview?.entries.find(e => selected && instrumentKey(e) === instrumentKey(selected))
  const total = preview ? quantityPoint(preview,data.history.snapshots.find(s => s.date === date)).total : null
  const steps = ['選帳戶','選標的','日期與數量','預覽確認']
  return <div ref={editor} className="quantity-editor form" role="region" aria-label="編輯歷史數量">
    <p className="eyebrow">步驟 {step + 1}／4</p><h4 tabIndex={-1}>{steps[step]}</h4>
    {step > 0 && account && <p className="quantity-selection">{account.name}{step > 1 && selected && <><br />{selected.symbol || selected.currency} · {selected.currency}</>}</p>}
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
      <label className="field"><span>歷史日期</span><input type="date" max={localDate(stamp())} disabled={!!expected} value={date} onChange={e => changeDate(e.target.value)} /></label>
      <label className="field"><span>當日絕對數量</span><input aria-label={`${nameOf({ ...selected,quantity:null })} 當日數量`} inputMode="decimal" value={quantity} onChange={e => { resetPreview(); setQuantity(e.target.value) }} /></label>
      <p className="muted small">填該日的絕對總數量，不是增減量。空白為未知，0 為確定未持有；同帳戶、同標的、同幣別合計所有批次。</p>
      <button onClick={() => { resetPreview(); setQuantity('') }}>清除數量（未知）</button>
    </>}
    {step === 3 && active && <>
      <p><strong>{date}</strong> · 數量 {active.quantity === null ? '未知' : fmt(active.quantity,8)}</p><Valuation entry={active} />
      <p className="notice" role="status">當日總資產：{total === null ? '資料不完整，圖表顯示缺口' : `NT$ ${fmt(total,2)}`}。只修改選定項目；同日其他已填數量保留，未填項目維持未知。</p>
      <p className="muted small">價格與匯率只取市場來源；不使用手填歷史價。負債沿用當日紀錄，沒有紀錄時保持未知。</p>
    </>}
    {error && <p role="alert" className="banner error">{error}</p>}
    <div className="quantity-actions">
      {step === 0 && <button className="primary" disabled={!account} onClick={() => setStep(1)}>下一步：選標的</button>}
      {step === 1 && <button className="primary" disabled={!selected} onClick={goToQuantity}>下一步：填數量</button>}
      {step === 2 && <button className="primary" disabled={loading} onClick={() => void prepare()}>{loading ? '取得歷史行情中…' : '取得歷史估值'}</button>}
      {step === 3 && <button className="primary" onClick={() => { try { if (preview) onApply(applyQuantityDay(latest.current,preview,baseline.current)) } catch (e) { setError(e instanceof Error ? e.message : '無法套用') } }}>套用歷史數量</button>}
      {step > 0 && <button onClick={() => { resetPreview(); setStep(step - 1) }}>{step === 3 ? '返回修改' : '上一步'}</button>}
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
          <div>{e.currency === 'TWD' ? 'TWD 匯率 1' : e.fx ? `Yahoo ${e.fx.symbol} · ${e.fx.date} 匯率 ${fmt(e.fx.value, 6)}` : '缺歷史匯率'}</div>
        </>
      )}
      {e.error && <p className="notice">{e.error}</p>}
    </div>
  )
}
