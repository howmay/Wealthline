import type { WealthData } from './model'
import { resolveCompletion } from './holdingPeriods'
import { localDate } from './history'
import { applyQuantityDay, instrumentKey, parseQuantityDays, validatePastDate, type CompleteInventory, type QuantityDay, type QuantityEntry } from './quantityHistory'

export interface QuantityBaseline {
  id:string
  date:string
  kind:'current'|'day'
  accounts:CompleteInventory['accounts']
  entries:QuantityEntry[]
  verified:boolean
  error:string
}
// Copy identities and quantities only. No source-day prices, FX or split basis may leak.
export function quantityOnly(e:QuantityEntry):QuantityEntry {
  return {accountId:e.accountId,account:e.account,category:e.category,country:e.country,type:e.type,symbol:e.symbol,currency:e.currency,quantity:e.quantity}
}
export function quantityBaselines(data:WealthData,now=new Date().toISOString()):QuantityBaseline[] {
  const current=new Map<string,QuantityEntry>()
  for(const a of data.accounts) for(const p of a.positions) {
    const e:QuantityEntry={accountId:a.id,account:a.name,category:a.category,country:a.country,type:p.type,symbol:p.type==='cash'?'':p.symbol.toUpperCase(),currency:p.currency,quantity:p.quantity}
    const key=instrumentKey(e), previous=current.get(key)
    if(previous) e.quantity=previous.quantity===null || !Number.isFinite(p.quantity) ? null : previous.quantity+p.quantity
    current.set(key,e)
  }
  const today=localDate(now)
  const candidates:QuantityBaseline[]=[{id:'current',date:today,kind:'current',accounts:data.accounts.map(a=>({id:a.id,name:a.name})),entries:[...current.values()],verified:true,error:''},
    ...(data.history.quantityDays ?? []).filter(d=>d.date<=today).slice().reverse().map(raw=>{
      const d=resolveCompletion(data,raw)
      const scope=d.inventory ?? d.completion
      const uncertainBasis=!!d.completion && d.entries.some(e=>e.quantityAsOf && e.quantityAsOf!==d.date && e.type!=='cash' && e.quantity!==0)
      const omittedSnapshot=!!d.completion && data.history.snapshots.some(s=>s.date===d.date && s.accounts.some(a=>a.value!==0 && !scope?.accounts.some(known=>known.id===a.id)))
      return {id:`day:${d.date}`,date:d.date,kind:'day' as const,accounts:scope?.accounts ?? [...new Map(d.entries.map(e=>[e.accountId,{id:e.accountId,name:e.account}])).values()],entries:d.entries.map(quantityOnly),verified:!!scope && !uncertainBasis && !omittedSnapshot,error:''}})]
  return candidates.map(b=>{
    let error=''
    if(b.entries.some(e=>e.quantity===null || !Number.isFinite(e.quantity) || e.quantity<0)) error='來源含未知或無效數量，請先補齊來源；不會補成 0。'
    else if(b.kind==='day' && !b.verified) error='這是部分或未驗證的歷史清單，不能作完整基底。請改用目前完整持倉，或已保存的完整回補清單。'

    return {...b,error}
  })
}
// Scope is a user-confirmed complete portfolio on the destination date, not the
// all-time catalog. Original sparse records remain sparse unless explicitly copied.
export function baselineDay(source:QuantityBaseline,date:string,entries:QuantityEntry[],now=new Date().toISOString(),mode:'copy'|'edit'='copy'):QuantityDay {
  validatePastDate(date,now)
  if(date===source.date && mode!=='edit') throw new Error('目的日必須與來源日不同；此流程不修改來源。')
  if(source.error) throw new Error(source.error)
  if(source.kind==='day' && !source.verified) throw new Error('未驗證的歷史清單不能作完整基底')
  const byKey=new Map(entries.map(e=>[instrumentKey(e),e]))
  if(entries.length!==source.entries.length || byKey.size!==source.entries.length || source.entries.some(e=>!byKey.has(instrumentKey(e)))) throw new Error('來源項目已改變，請重新選取基底')
  return parseQuantityDays([{date,updatedAt:now,entries:source.entries.map(e=>({...quantityOnly(e),quantity:byKey.get(instrumentKey(e))!.quantity})),inventory:{accounts:source.accounts,source:{kind:source.kind,date:source.date}}}])[0]
}
export function baselineRevision(data:WealthData,sourceId:string,date:string,now=new Date().toISOString()) {
  const source=quantityBaselines(data,now).find(b=>b.id===sourceId)
  return JSON.stringify({source,day:data.history.quantityDays?.find(d=>d.date===date),snapshot:data.history.snapshots.find(s=>s.date===date),periods:data.history.holdingPeriods,changes:data.history.changes})
}
export function applyBaseline(data:WealthData,day:QuantityDay,sourceId:string,revision:string,confirmed:boolean,now=new Date().toISOString(),mode:'copy'|'edit'='copy'):WealthData {
  if(!confirmed) throw new Error('請確認完整範圍與目的日差異')
  if(baselineRevision(data,sourceId,day.date,now)!==revision) throw new Error('來源或目的日資料已變更，請重新預覽')
  const source=quantityBaselines(data,now).find(b=>b.id===sourceId)
  if(!source) throw new Error('來源已不存在，請重新選取')
  const validated=baselineDay(source,day.date,day.entries,now,mode)
  const previous=data.history.quantityDays?.find(d=>d.date===day.date)
  const scope=previous?.inventory ?? previous?.completion
  const inventory=mode==='edit' && source.kind==='day' && source.date===day.date && scope ? {...validated.inventory!,source:scope.source} : validated.inventory
  return applyQuantityDay(data,{...day,inventory},previous)
}
