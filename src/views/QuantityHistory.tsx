import { useEffect, useRef, useState } from 'react'
import type { WealthData } from '../model'
import { localDate } from '../history'
import { applyQuantityDay, entriesForDate, entryValue, instrumentKey, parseQuantityDays, quantityPoint, validatePastDate, valueEntries, type QuantityDay, type QuantityEntry } from '../quantityHistory'
import { fmt } from '../format'

export interface QuantityEditRequest { date:string; expected?:QuantityDay }
export function QuantityHistory({data,onChange,request,onRequest}: {data:WealthData;onChange:(d:WealthData)=>void;request?:QuantityEditRequest;onRequest:(request:QuantityEditRequest|undefined)=>void}) {
  const editing=request
  const setEditing=onRequest
  const [undo,setUndo] = useState<{before:QuantityDay[]|undefined;after:QuantityDay[]}|null>(null)
  const [error,setError] = useState('')
  const days = data.history.quantityDays ?? []
  const apply = (next:WealthData) => { setUndo({before:data.history.quantityDays,after:next.history.quantityDays!});onChange(next) }
  return <section className="panel" aria-label="歷史持倉數量">
    <div className="panel-head"><h3>歷史持倉數量</h3><button onClick={()=>setEditing({date:localDate(new Date().toISOString())})}>＋ 補登歷史數量</button></div>
    <p className="muted small">按帳戶記錄某一天的實際持有總數量。同帳戶同標的同幣別合計多批次，不同帳戶分開。只影響選定日期；不修改目前持倉，也不推定其他日期。</p>
    <p className="muted small">每日紀錄可按「編輯數量」修正。價格與匯率統一取自 Yahoo：使用當日或前 7 日內最近已知收盤價，顯示實際行情日期。來源最多查近 10 年；長期停牌、無報價商品及缺資料留空，不套用今日價格。</p>
    {error && <p role="alert" className="banner error">{error}</p>}
    {undo && <button onClick={()=>{
      if(data.history.quantityDays !== undo.after){setError('歷史已變更，無法直接復原；請重新檢查。');return}
      onChange({...data,history:{...data.history,quantityDays:undo.before ?? []}});setUndo(null)
    }}>復原上次歷史修改</button>}
    {editing && <QuantityEditor key={editing.date} data={data} date={editing.date} expected={editing.expected} onCancel={()=>setEditing(undefined)} onApply={next=>{apply(next);setEditing(undefined)}} />}
    {!days.length && <p className="muted">尚未手動補登。舊每日快照只有總額，無法從總額還原各持倉數量。</p>}
    {[...days].reverse().map(day=><article className="quantity-day" key={day.date}>
      <div className="panel-head"><strong>{day.date} · 手動數量</strong><div className="row"><button onClick={()=>setEditing({date:day.date,expected:day})}>編輯 {day.date}</button><button className="danger" onClick={()=>{
        if(confirm(`移除 ${day.date} 的手動補登？會恢復原快照（若存在），目前持倉不變。`)) apply({...data,history:{...data.history,quantityDays:days.filter(d=>d!==day)}})
      }}>移除 {day.date}</button></div></div>
      <div className="quantity-rows">{day.entries.map(entry=><div className="quantity-row" key={instrumentKey(entry)}><strong>{entry.account} · {entry.symbol || entry.currency} · {entry.currency}</strong><span>數量 {entry.quantity === null ? '未知' : fmt(entry.quantity,8)}</span><Valuation entry={entry}/></div>)}</div>
    </article>)}
  </section>
}
export function QuantityEditor({data,date:initialDate,expected,onCancel,onApply}:{data:WealthData;date:string;expected?:QuantityDay;onCancel:()=>void;onApply:(data:WealthData)=>void}) {
  const [date,setDate] = useState(initialDate)
  const [today] = useState(()=>localDate(new Date().toISOString()))
  const [entries,setEntries] = useState<QuantityEntry[]>(()=>entriesForDate(data,initialDate))
  const [drafts,setDrafts] = useState<string[]>(()=>entriesForDate(data,initialDate).map(e=>e.quantity?.toString()??''))
  const [preview,setPreview] = useState<QuantityDay|null>(null)
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState('')
  const [accountFilter,setAccountFilter] = useState('')
  const [symbol,setSymbol] = useState(''),[currency,setCurrency] = useState('TWD'),[accountId,setAccountId] = useState(data.accounts[0]?.id??''),[type,setType] = useState<'cash'|'holding'>('holding')
  const editorRef=useRef<HTMLDivElement>(null)
  useEffect(()=>{editorRef.current?.scrollIntoView?.({block:'start'})},[])
  const revision = useRef(0), live = useRef(true), latest = useRef(data)
  useEffect(()=>{latest.current = data},[data])
  useEffect(()=>{live.current=true;return ()=>{live.current=false}},[])
  const resetPreview = ()=>{revision.current++;setLoading(false);setPreview(null);setError('')}
  const changeDate = (next:string)=>{
    resetPreview();setDate(next)
    const values=entriesForDate(latest.current,next);setEntries(values);setDrafts(values.map(e=>e.quantity?.toString()??''))
  }
  const prepare = async()=>{
    resetPreview()
    const request=revision.current
    try {
      validatePastDate(date)
      if(!expected && latest.current.history.quantityDays?.some(d=>d.date===date)) throw new Error('這一天已有補登，請取消後使用該日的編輯按鈕')
      const rows=entries.map((e,i)=>({...e,quantity:drafts[i].trim()===''?null:Number(drafts[i])}))
      const candidate={date,updatedAt:new Date().toISOString(),entries:rows}
      parseQuantityDays([candidate])
      if(!rows.length) throw new Error('請先加入至少一項歷史持倉')
      setLoading(true)
      const valued=await valueEntries(rows,date)
      if(live.current && revision.current===request) setPreview({...candidate,entries:valued})
    } catch(e){if(live.current && revision.current===request)setError(e instanceof Error?e.message:'無法取得歷史行情')}
    finally{if(live.current && revision.current===request)setLoading(false)}
  }
  const total=preview?quantityPoint(preview,data.history.snapshots.find(s=>s.date===date)).total:null
  return <div ref={editorRef} className="quantity-editor form" role="region" aria-label="編輯歷史數量">
    <h4>{expected?'編輯歷史數量':'補登歷史數量'}</h4>
    <label className="field"><span>歷史日期</span><input type="date" max={today} disabled={!!expected} value={date} onChange={e=>changeDate(e.target.value)}/></label>
    <p className="muted small">日期為日曆日期，不做 UTC 換日。空白代表未知，0 代表當日確定未持有。先逐項確認，再取得估值與套用；新日期不會自動複製目前數量。請加入當日所有持倉；未曾留下紀錄的項目無法自動還原。切換日期會捨棄尚未套用的輸入。</p>
    <label className="field"><span>篩選歷史帳戶</span><select value={accountFilter} onChange={e=>setAccountFilter(e.target.value)}><option value="">全部帳戶</option>{[...new Map(entries.map(e=>[e.accountId,e.account]))].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    {entries.map((entry,i)=><div className="quantity-row" key={instrumentKey(entry)} hidden={!!accountFilter && entry.accountId!==accountFilter}>
      <label className="field"><span>{entry.account} · {entry.symbol || entry.currency} · {entry.currency} 當日數量</span><input inputMode="decimal" value={drafts[i]} onChange={e=>{resetPreview();setDrafts(d=>d.map((v,j)=>j===i?e.target.value:v))}}/></label>
      <small className="muted">{entry.type==='cash'?'現金：幣別單位值為 1':'合計同帳戶、同標的、同幣別的所有批次'}</small>
      <button type="button" onClick={()=>{resetPreview();setDrafts(d=>d.map((v,j)=>j===i?'':v))}}>清除數量（未知）</button>
      {preview && <Valuation entry={preview.entries[i]}/>}
    </div>)}
    <details><summary>加入未列出的歷史持倉</summary><p className="muted small">在既有帳戶補登已售出或未曾留下紀錄的標的，不新增目前持倉。</p>
      <label className="field"><span>歷史持倉帳戶</span><select value={accountId} onChange={e=>setAccountId(e.target.value)}>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="field"><span>歷史持倉類型</span><select value={type} onChange={e=>setType(e.target.value as typeof type)}><option value="holding">持倉</option><option value="cash">現金</option></select></label>
      {type==='holding' && <label className="field"><span>歷史標的代號</span><input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())}/></label>}
      <label className="field"><span>歷史持倉幣別</span><input value={currency} onChange={e=>setCurrency(e.target.value.toUpperCase())}/></label>
      <button onClick={()=>{try{const a=data.accounts.find(a=>a.id===accountId);if(!a)throw new Error('請先選擇帳戶');const entry:QuantityEntry={accountId:a.id,account:a.name,category:a.category,country:a.country,type,symbol:type==='cash'?'':symbol.trim(),currency:currency.trim(),quantity:null};parseQuantityDays([{date,updatedAt:new Date().toISOString(),entries:[...entries,entry]}]);resetPreview();setEntries([...entries,entry]);setDrafts([...drafts,'']);setAccountFilter('')}catch(e){setError(e instanceof Error?e.message:'資料不正確')}}}>加入歷史持倉欄位</button>
    </details>
    {error && <p role="alert" className="banner error">{error}</p>}
    {preview && <p role="status" className="notice">當日總資產：{total===null?'資料不完整，圖表顯示缺口':`NT$ ${fmt(total,2)}`}。負債只沿用當日原始紀錄；沒有紀錄時維持未知。套用不會更動目前餘額。</p>}
    <div className="row"><button disabled={loading} onClick={()=>void prepare()}>{loading?'取得歷史行情中…':'取得歷史估值'}</button><button className="primary" disabled={!preview || loading} onClick={()=>{try{if(preview)onApply(applyQuantityDay(latest.current,preview,expected))}catch(e){setError(e instanceof Error?e.message:'無法套用')}}}>套用歷史數量</button><button onClick={()=>{revision.current++;onCancel()}}>取消歷史編輯</button></div>
    <p className="muted small">套用後仍需「儲存變更」才會寫入 Drive。移除補登可恢復原始快照；取得不到行情仍可保留數量，估值維持未知。</p>
  </div>
}
function Valuation({entry:e}:{entry:QuantityEntry}) {
  const value=entryValue(e)
  return <div className="small"><span>{value===null?'估值未知':`NT$ ${fmt(value,2)}`}</span>{e.quantity!==null && e.quantity!==0 && <>
    <div>{e.type==='cash'?'單位值 1':e.price?`Yahoo ${e.price.symbol} · ${e.price.date} 收盤 ${fmt(e.price.value,6)} ${e.currency}`:'缺歷史收盤價'}</div>
    <div>{e.currency==='TWD'?'TWD 匯率 1':e.fx?`Yahoo ${e.fx.symbol} · ${e.fx.date} 匯率 ${fmt(e.fx.value,6)}`:'缺歷史匯率'}</div>
  </>}{e.error && <p className="notice">{e.error}</p>}</div>
}
