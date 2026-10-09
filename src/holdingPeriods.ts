import type { WealthData } from './model'
import { calendarDate, validateTimeZone } from './loanSchedule'
import { localDate } from './history'
import { entriesForDate, historyCatalog, instrumentKey, parseQuantityDays, validDate, type HistoricalInstrument, type QuantityDay } from './quantityHistory'

export interface HoldingPeriod extends HistoricalInstrument {
  id: string
  updatedAt: string
  start: string // inclusive closing position on this literal calendar date
  end?: string // exclusive: zero at the close on this date
  quantity: number
  timeZone: string
}
export const MAX_PERIOD_DAYS = 3660
const DAY = 86400000
export function shiftDate(date: string, days: number) { return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0,10) }
export function parseHoldingPeriods(raw: unknown): HoldingPeriod[] {
  if (!Array.isArray(raw)) throw new Error('持有期間必須是陣列')
  const ids = new Set<string>(), zones = new Map<string,string>()
  return raw.map(value => {
    const p = value as HoldingPeriod
    if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id) || typeof p.updatedAt !== 'string' || !Number.isFinite(Date.parse(p.updatedAt))) throw new Error('持有期間識別碼或時間不正確')
    if (!validDate(p.start) || (p.end !== undefined && (!validDate(p.end) || p.end <= p.start))) throw new Error('結束／賣出日必須晚於開始日（開始含、結束不含）')
    try { validateTimeZone(p.timeZone) } catch { throw new Error('持有期間須填寫有效的 IANA 日曆時區，例如 Asia/Taipei') }
    const entry = parseQuantityDays([{ date:p.start, updatedAt:p.updatedAt, entries:[p] }])[0].entries[0]
    if (entry.quantity === null) throw new Error('持有期間必須填寫絕對數量')
    const key = instrumentKey(entry)
    if (zones.has(key) && zones.get(key) !== p.timeZone) throw new Error('同帳戶同標的的持有期間須使用相同日曆時區')
    ids.add(p.id); zones.set(key,p.timeZone)
    const { quantity, price: _price, fx: _fx, error: _error, ...identity } = entry
    return { ...identity, id:p.id, updatedAt:p.updatedAt, start:p.start, ...(p.end && {end:p.end}), quantity:quantity!, timeZone:p.timeZone }
  })
}
export function validatePeriodInput(p: HoldingPeriod, now = new Date().toISOString()) {
  parseHoldingPeriods([p])
  const today = calendarDate(now,p.timeZone)
  if (p.start > today || (p.end && p.end > today)) throw new Error('開始及結束日不可晚於期間時區的今天')
  if (p.start < shiftDate(today,-MAX_PERIOD_DAYS)) throw new Error('一次持有期間最多回溯近十年（3660 日），請縮短日期')
}
export interface HeldQuantity { quantity: number | null; basisDate: string }
// A period begins a baseline, its end clears that baseline. Later period starts retire
// earlier scheduled ends; explicit daily counts and quantity changes override the day.
export function periodQuantityOn(data: WealthData, identity: HistoricalInstrument, date: string): HeldQuantity | undefined {
  const key = instrumentKey(identity)
  const periods = (data.history.holdingPeriods ?? []).filter(p => instrumentKey(p) === key)
  if (!periods.length || date < periods.map(p=>p.start).sort()[0]) return undefined
  type Event = { date:string; rank:number; order:number; quantity:number|null; owner?:string; end?:boolean }
  const events: Event[] = []
  periods.forEach((p,i) => {
    events.push({date:p.start,rank:0,order:i,quantity:p.quantity,owner:p.id})
    if (p.end) events.push({date:p.end,rank:1,order:i,quantity:0,owner:p.id,end:true})
  })
  for (const c of data.history.changes) {
    if (c.accountId !== identity.accountId || c.type !== identity.type || c.currency !== identity.currency || (c.type === 'holding' && c.symbol.toUpperCase() !== identity.symbol.toUpperCase())) continue
    if (c.before && c.after && c.before.quantity === c.after.quantity) continue
    events.push({date:calendarDate(c.at,periods[0].timeZone),rank:2,order:Date.parse(c.at),quantity:c.after?.quantity ?? 0})
  }
  for (const day of data.history.quantityDays ?? []) {
    const entry = day.entries.find(e=>instrumentKey(e)===key)
    if (entry) events.push({date:day.date,rank:3,order:0,quantity:entry.quantity})
  }
  events.sort((a,b)=>a.date.localeCompare(b.date)||a.rank-b.rank||a.order-b.order)
  let owner: string | undefined, result: HeldQuantity | undefined
  for (const event of events) {
    if (event.date > date) break
    if (event.end) { if (owner !== event.owner) continue }
    else if (event.owner) owner = event.owner
    result = {quantity:event.quantity,basisDate:event.date}
  }
  return result
}
export function periodConflicts(data: WealthData, p: HoldingPeriod): string[] {
  const key=instrumentKey(p), messages:string[]=[]
  for (const old of data.history.holdingPeriods ?? []) if (instrumentKey(old)===key && (!old.end || old.end >= p.start) && (!p.end || old.start <= p.end)) messages.push(`期間 ${old.start} 至 ${old.end ?? '持續持有'}：${old.quantity} → 新基準 ${p.quantity}；按較晚開始日接手，同日以後新增者優先，原紀錄保留`)
  for (const day of data.history.quantityDays ?? []) {
    const e=day.entries.find(e=>instrumentKey(e)===key)
    if(e && day.date>=p.start) messages.push(`單日 ${day.date}：${e.quantity ?? '未知'}（保留且優先；不改為期間數量 ${p.quantity}）`)
  }
  for(const c of data.history.changes) if(c.accountId===p.accountId && c.type===p.type && c.currency===p.currency && (c.type==='cash'||c.symbol.toUpperCase()===p.symbol.toUpperCase()) && (!c.before||!c.after||c.before.quantity!==c.after.quantity)) {
    const date=calendarDate(c.at,p.timeZone)
    if(date>=p.start) messages.push(`數量異動 ${date}：${c.after?.quantity ?? 0}（保留；期間內在結束日前優先，結束日後再買可恢復持倉）`)
  }
  return messages
}
export function periodRevision(data: WealthData) { return JSON.stringify({periods:data.history.holdingPeriods,days:data.history.quantityDays,changes:data.history.changes,accounts:data.accounts}) }
export function applyHoldingPeriod(data: WealthData, period: HoldingPeriod, expectedRevision: string, confirmed: boolean, now = new Date().toISOString()): WealthData {
  if (periodRevision(data)!==expectedRevision) throw new Error('歷史或持倉已變更，請重新預覽期間')
  validatePeriodInput(period,now)
  if(periodConflicts(data,period).length && !confirmed) throw new Error('請先確認重疊期間與明確數量紀錄的差異')
  const holdingPeriods=parseHoldingPeriods([...(data.history.holdingPeriods ?? []),period])
  const next:WealthData={...data,version:5,history:{...data.history,holdingPeriods}}
  expandPeriodDays(next,now) // bound work before accepting the edit
  return next
}
export function expandPeriodDays(data: WealthData, now = new Date().toISOString()): QuantityDay[] {
  const periods=data.history.holdingPeriods ?? []
  if(!periods.length) return data.history.quantityDays ?? []
  const today=localDate(now), from=[...periods.map(p=>p.start)].sort()[0]
  const start=from < shiftDate(today,-MAX_PERIOD_DAYS) ? shiftDate(today,-MAX_PERIOD_DAYS) : from
  const catalog=historyCatalog(data), result=new Map((data.history.quantityDays ?? []).map(d=>[d.date,d]))
  const days=Math.max(0,(Date.parse(today)-Date.parse(start))/DAY)
  if(days*catalog.length>50000) throw new Error('期間估值超過 50,000 項日資料，請縮短期間或減少標的')
  for(let date=start;date<today;date=shiftDate(date,1)) {
    const existing=entriesForDate(data,date)
    const entries=catalog.map(identity=>{
      const state=periodQuantityOn(data,identity,date)
      if(state) return {...identity,quantity:state.quantity,quantityAsOf:state.basisDate}
      return existing.find(e=>instrumentKey(e)===instrumentKey(identity)) ?? {...identity,quantity:null}
    })
    result.set(date,{date,updatedAt:now,entries,periodDerived:!result.has(date)})
  }
  return [...result.values()].sort((a,b)=>a.date.localeCompare(b.date))
}
