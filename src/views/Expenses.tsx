import { useEffect, useRef, useState, type FormEvent } from 'react'
import { mergeExpenses, parseExpense, prepareExpenses, sha256, type Expense } from '../expenses'
import { assertCreditCardFile, parseStatement } from '../statements'
import { fmt } from '../format'
import type { WealthData } from '../model'

export function Expenses({data,onChange,busy}: {data:WealthData;onChange:(next:WealthData)=>void;busy:boolean}) {
  const [importing,setImporting] = useState(false)
  const [editing,setEditing] = useState<Expense|null>(null)
  const [message,setMessage] = useState('')
  const expenses = data.expenses ?? []
  if(importing) return <StatementImport existing={expenses} busy={busy} onCancel={()=>setImporting(false)} onImport={(rows,context)=>{
    const result = mergeExpenses(expenses,rows,context)
    if(result.added) onChange({...data,version:10,expenses:result.expenses})
    setMessage(`已加入 ${result.added} 筆，略過 ${result.duplicates} 筆重複。`)
    setImporting(false)
  }}/>
  if(editing) return <ExpenseEditor expense={editing} busy={busy} onCancel={()=>setEditing(null)} onSave={expense=>{
    onChange({...data,version:10,expenses:expenses.map(e=>e.id===expense.id?expense:e)})
    setEditing(null)
  }}/>
  return <div className="expenses-page">
    <div className="page-head"><div><h2>消費明細</h2><p className="muted">從信用卡帳單匯入並整理交易。修改後請按「儲存變更」保存；這些紀錄不會自動扣除資產或變更信用卡負債。</p></div><button className="primary" disabled={busy} onClick={()=>{setMessage('');setImporting(true)}}>匯入信用卡帳單</button></div>
    {message && <p role="status" className="notice">{message}</p>}
    {!expenses.length ? <section className="panel empty"><p>還沒有消費紀錄。選擇文字 PDF 帳單，預覽確認後即可匯入。</p></section> : <section className="panel">
      <h3>{expenses.length} 筆交易</h3>
      <div className="table-wrap"><table className="data expense-table"><thead><tr><th>日期</th><th>銀行／卡片</th><th>商家／說明</th><th className="num">金額</th><th>操作</th></tr></thead><tbody>
        {[...expenses].sort((a,b)=>b.date.localeCompare(a.date)).map(e=><tr key={e.id}><td>{e.date}</td><td>{e.card}</td><td>{e.description}</td><td className="num">{e.currency} {fmt(e.amount)}</td><td><button disabled={busy} aria-label={`編輯消費 ${e.date} ${e.description}`} onClick={()=>setEditing(e)}>編輯</button></td></tr>)}
      </tbody></table></div>
    </section>}
  </div>
}

function ExpenseEditor({expense,busy,onSave,onCancel}: {expense:Expense;busy:boolean;onSave:(e:Expense)=>void;onCancel:()=>void}) {
  const [draft,setDraft] = useState(expense)
  const [amount,setAmount] = useState(String(expense.amount))
  const [error,setError] = useState('')
  return <form className="panel form" onSubmit={e=>{e.preventDefault();try {if(!amount.trim()) throw new Error('請填寫金額');onSave(parseExpense({...draft,amount:Number(amount)}))} catch(e){setError(e instanceof Error?e.message:'資料無效')}}}>
    <h2>編輯消費明細</h2>
    <fieldset disabled={busy} className="expense-fields">
      <label className="field"><span>消費日期</span><input type="date" required value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/></label>
      <label className="field"><span>銀行／卡片名稱</span><input required maxLength={100} value={draft.card} onChange={e=>setDraft({...draft,card:e.target.value})}/></label>
      <label className="field"><span>商家／說明</span><input required maxLength={500} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
      <label className="field"><span>金額（退款填負數）</span><input required type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      <label className="field"><span>幣別</span><input required pattern="[A-Z]{3}" value={draft.currency} onChange={e=>setDraft({...draft,currency:e.target.value.toUpperCase()})}/></label>
    </fieldset>
    {error && <p role="alert" className="banner error">{error}</p>}
    <div className="row"><button className="primary" disabled={busy}>套用修改</button><button type="button" onClick={onCancel}>取消</button></div>
  </form>
}

type Draft = Expense & {selected:boolean;amountText:string;needsReview?:boolean}
function StatementImport({existing,busy,onCancel,onImport}: {existing:Expense[];busy:boolean;onCancel:()=>void;onImport:(rows:Expense[],context:Expense[])=>void}) {
  const [file,setFile] = useState<File|null>(null)
  const [password,setPassword] = useState('')
  const [card,setCard] = useState('')
  const [month,setMonth] = useState(()=>new Date().toISOString().slice(0,7))
  const [currency,setCurrency] = useState('TWD')
  const [parsing,setParsing] = useState(false)
  const [drafts,setDrafts] = useState<Draft[]|null>(null)
  const [skipped,setSkipped] = useState<string[]>([])
  const [error,setError] = useState('')
  const controller = useRef<AbortController|null>(null)
  useEffect(()=>()=>controller.current?.abort(),[])
  const locked = busy || parsing
  const patch = (id:string,fields:Partial<Draft>) => setDrafts(rows=>rows?.map(r=>r.id===id?{...r,...fields}:r) ?? null)
  const selected = (drafts ?? []).filter(r=>r.selected)
  const existingSourceKeys = new Set(existing.map(e=>e.sourceKey))
  const existingImportKeys = new Set(existing.map(e=>e.importKey))
  let result:ReturnType<typeof mergeExpenses>|null = null
  let validation = ''
  try {
    result = mergeExpenses(existing,selected.map(r=>{
      if(r.needsReview && r.description.includes('商家未能辨識')) throw new Error('請先補上未辨識的商家，並核對是否為繳款')
      if(!r.amountText.trim()) throw new Error('請填寫每筆金額')
      return {...r,amount:Number(r.amountText)}
    }),drafts ?? [])
  } catch(e) {validation = e instanceof Error?e.message:'請檢查資料'}

  async function parse(e:FormEvent) {
    e.preventDefault()
    if(locked || !file) return
    setError('');setParsing(true)
    const abort = new AbortController()
    controller.current = abort
    const secret = password
    setPassword('')
    try {
      assertCreditCardFile(file.name)
      if(file.size > 20*1024*1024) throw new Error('帳單超過 20 MB，請拆分後再匯入')
      const bytes = new Uint8Array(await file.arrayBuffer())
      if(new TextDecoder().decode(bytes.slice(0,5)) !== '%PDF-') throw new Error('請選擇有效的 PDF 檔案')
      const fileHash = await sha256(bytes)
      const {readStatementPdf} = await import('../statementPdf')
      if(abort.signal.aborted) return
      const lines = await readStatementPdf(bytes,secret,abort.signal)
      const parsed = parseStatement(lines,month,currency,file.name)
      if(!parsed.rows.length) throw new Error('沒有辨識到交易。此帳單的排版暫不支援，尚未匯入任何資料。')
      const rows = await prepareExpenses(parsed.rows,card,fileHash)
      if(abort.signal.aborted) return
      setDrafts(rows.map((r,i)=>({...r,selected:!parsed.review.includes(i),needsReview:parsed.review.includes(i),amountText:String(r.amount)})))
      setSkipped(parsed.skipped)
      setFile(null)
    } catch(e) {if(!abort.signal.aborted) setError(e instanceof Error?e.message:'無法解析帳單')}
    finally {if(!abort.signal.aborted) setParsing(false)}
  }
  return <section className="panel statement-import">
    <div className="panel-head"><h2>匯入信用卡帳單</h2><button onClick={()=>{controller.current?.abort();onCancel()}}>取消匯入</button></div>
    <p className="notice">PDF 與密碼只在此瀏覽器解密及解析，不傳送到伺服器、不保存原始檔或密碼。確認後的消費明細會隨資料檔儲存在此瀏覽器或你的 Google Drive。</p>
    <p className="muted small">支援富邦與玉山文字帳單的入帳欄位，使用最後的臺幣帳單金額。匯豐缺少商家文字的交易預設不勾選，請對照原帳單補上商家並排除繳款後再選取。證券帳單不支援；掃描圖片及其他排版可能無法辨識，請核對完整性。退款以負數記錄，繳款與總計不當作消費。</p>
    {error && <p className="banner error" role="alert">{error}</p>}
    {!drafts ? <form onSubmit={parse}>
      <fieldset className="expense-fields" disabled={locked}>
        <label className="field"><span>帳單 PDF</span><input type="file" accept=".pdf,application/pdf" required onChange={e=>{setFile(e.target.files?.[0]??null);setPassword('');setError('')}}/></label>
        <label className="field"><span>PDF 密碼（若有）</span><input type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <label className="field"><span>銀行／卡片名稱</span><input required maxLength={100} placeholder="例如：玉山 / 旅遊卡" value={card} onChange={e=>setCard(e.target.value)}/><small className="muted">同一張卡請沿用相同名稱，供重複交易比對。毋須完整卡號。</small></label>
        <label className="field"><span>帳單月份</span><input type="month" required value={month} onChange={e=>setMonth(e.target.value)}/><small className="muted">用於補齊未列年份的日期，跨年交易使用前一年。</small></label>
        <label className="field"><span>帳單金額幣別</span><input required pattern="[A-Z]{3}" maxLength={3} value={currency} onChange={e=>setCurrency(e.target.value.toUpperCase())}/></label>
      </fieldset>
      <button className="primary" disabled={locked || !file}>{parsing?'正在本機解析…':'解析並預覽'}</button>
    </form> : <>
      <div className="page-head"><div><h3>確認交易 · {card}</h3><p className="muted">辨識 {drafts.length} 筆。可取消勾選或修改內容；相同交易依出現次數比對，保留同日同額的多筆消費。</p></div></div>
      <div className="expense-preview">{drafts.map((r,i)=>{
        const duplicate = (r.sourceKey && existingSourceKeys.has(r.sourceKey)) || (r.importKey && existingImportKeys.has(r.importKey))
        return <fieldset key={r.id} className="expense-draft" disabled={busy} aria-label={`交易 ${i+1}`}>
          <label className="expense-select"><input type="checkbox" checked={r.selected} onChange={e=>patch(r.id,{selected:e.target.checked})}/><strong>第 {i+1} 筆</strong>{r.needsReview && <span className="tag">請核對商家與繳款</span>}{duplicate && <span className="tag">原始交易已匯入</span>}</label>
          <div className="expense-fields">
            <label className="field"><span>日期</span><input type="date" aria-label={`第 ${i+1} 筆日期`} value={r.date} onChange={e=>patch(r.id,{date:e.target.value})}/></label>
            <label className="field expense-description"><span>商家／說明</span><input maxLength={500} aria-label={`第 ${i+1} 筆商家`} value={r.description} onChange={e=>patch(r.id,{description:e.target.value})}/></label>
            <label className="field"><span>金額</span><input type="number" step="0.01" aria-label={`第 ${i+1} 筆金額`} value={r.amountText} onChange={e=>patch(r.id,{amountText:e.target.value})}/></label>
            <label className="field"><span>幣別</span><input maxLength={3} aria-label={`第 ${i+1} 筆幣別`} value={r.currency} onChange={e=>patch(r.id,{currency:e.target.value.toUpperCase()})}/></label>
          </div>
        </fieldset>
      })}</div>
      <button disabled={busy} onClick={()=>setDrafts(rows=>[...(rows??[]),{id:crypto.randomUUID(),date:`${month}-01`,description:'',amount:0,amountText:'',currency,card,selected:true}])}>＋ 補上一筆交易</button>
      {!!skipped.length && <details className="notice"><summary>未匯入的文字列（{skipped.length}）：含總計、繳款與無法辨識內容</summary><p className="small">只在本次預覽顯示，離開後不保存。請核對是否有漏掉的交易。</p><ul>{skipped.map((line,i)=><li key={i}>{line}</li>)}</ul></details>}
      {validation && <p role="alert" className="banner error">{validation}</p>}
      <p role="status">選取 {selected.length} 筆 · 可新增 {result?.added ?? 0} 筆 · 略過重複 {result?.duplicates ?? 0} 筆</p>
      <button className="primary" disabled={busy || !!validation || !result?.added} onClick={()=>{try{onImport(selected.map(r=>({...r,amount:Number(r.amountText)})),drafts)}catch(e){setError(e instanceof Error?e.message:'匯入失敗')}}}>確認匯入 {result?.added ?? 0} 筆</button>
    </>}
  </section>
}
