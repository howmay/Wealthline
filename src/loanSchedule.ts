import { estimateLoan, type RepaymentMethod } from './loanEstimate'
import type { Liability } from './liabilities'

export interface LoanSchedule {
  source: 'original' | 'correction'
  baseDate: string // balance is the principal at the END of this calendar day
  firstDueDate: string // first unpaid installment after the baseline
  monthlyDay: number // fixed 1..31 anchor; short months clamp, never drift
  timeZone: string // stored IANA calendar timezone, independent of device timezone
}
export interface LoanBasis {
  id: string
  at: string
  reason: string
  currency: string
  balance: number
  annualRate?: number
  remainingInstallments?: number
  repaymentMethod?: RepaymentMethod
  schedule?: LoanSchedule
}
export const isCalendarDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '0001-01-01' && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
export function validateTimeZone(zone: string) {
  if (typeof zone !== 'string' || !zone.trim()) throw new Error('請填寫貸款日曆時區')
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date(0)) }
  catch { throw new Error('貸款時區必須是有效的 IANA 時區，例如 Asia/Taipei') }
}
export function calendarDate(at: string, timeZone: string): string {
  validateTimeZone(timeZone)
  if (!Number.isFinite(Date.parse(at))) throw new Error('無效的計算時間')
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at))
  return `${parts.find(p => p.type === 'year')!.value.padStart(4, '0')}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`
}
const daysInMonth = (year: number, month: number) => month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4,6,9,11].includes(month) ? 30 : 31
export function monthlyDate(first: string, monthlyDay: number, offset: number): string {
  if (!isCalendarDate(first) || !Number.isInteger(monthlyDay) || monthlyDay < 1 || monthlyDay > 31 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('還款日期或期數不正確')
  const [year, month] = first.split('-').map(Number)
  const index = year * 12 + month - 1 + offset
  const y = Math.floor(index / 12), m = index % 12 + 1
  if (y > 9999) throw new Error('還款日期超出支援範圍')
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2,'0')}-${String(Math.min(monthlyDay, daysInMonth(y,m))).padStart(2,'0')}`
}
export function nextMonthlyDate(base: string, monthlyDay: number): string {
  const same = monthlyDate(base, monthlyDay, 0)
  return same > base ? same : monthlyDate(base, monthlyDay, 1)
}
export function parseSchedule(raw: unknown): LoanSchedule {
  if (!raw || typeof raw !== 'object') throw new Error('自動估算日程格式不正確')
  const r = raw as LoanSchedule
  if (r.source !== 'original' && r.source !== 'correction') throw new Error('貸款基準來源不正確')
  if (typeof r.baseDate !== 'string' || typeof r.firstDueDate !== 'string' || !isCalendarDate(r.baseDate) || !isCalendarDate(r.firstDueDate)) throw new Error('基準日及首次還款日必須是有效日期')
  validateTimeZone(r.timeZone)
  if (!Number.isInteger(r.monthlyDay) || r.monthlyDay < 1 || r.monthlyDay > 31) throw new Error('每月還款日必須是 1–31 的整數')
  if (r.firstDueDate <= r.baseDate) throw new Error('首次／下一次還款日必須晚於基準日；基準本金為該日結束時的餘額')
  if (monthlyDate(r.firstDueDate, r.monthlyDay, 0) !== r.firstDueDate) throw new Error('首次／下一次日期與每月還款日不一致（短月應為月底）')
  return { source: r.source, baseDate: r.baseDate, firstDueDate: r.firstDueDate, monthlyDay: r.monthlyDay, timeZone: r.timeZone }
}
export interface DebtProjection {
  balance: number | null
  remaining: number | null
  elapsed: number
  principalRepaid: number
  nextDueDate?: string
  asOf?: string
  estimated: boolean
}
export function projectLiability(d: Liability, at: string): DebtProjection {
  if (!d.schedule) return { balance: d.balance, remaining: d.remainingInstallments ?? null, elapsed: 0, principalRepaid: 0, nextDueDate: d.nextDueDate, estimated: false }
  const s = parseSchedule(d.schedule)
  const asOf = calendarDate(at, s.timeZone)
  if (s.source === 'correction' && asOf < s.baseDate) return { balance: null, remaining: null, elapsed: 0, principalRepaid: 0, asOf, estimated: true }
  if (d.balance === 0) return { balance: 0, remaining: 0, elapsed: 0, principalRepaid: 0, asOf, estimated: true }
  if (d.kind === 'credit' || !d.repaymentMethod || d.repaymentMethod === 'none') throw new Error('此負債不適用按期估算')
  const loan = estimateLoan({ principal: d.balance, annualRate: d.annualRate!, periods: d.remainingInstallments!, method: d.repaymentMethod })
  let elapsed = 0
  while (elapsed < loan.rows.length && monthlyDate(s.firstDueDate, s.monthlyDay, elapsed) <= asOf) elapsed++
  const balance = elapsed ? loan.rows[elapsed - 1].closingBalance : d.balance
  return { balance, remaining: loan.rows.length - elapsed, elapsed, principalRepaid: d.balance - balance,
    ...(elapsed < loan.rows.length && { nextDueDate: monthlyDate(s.firstDueDate, s.monthlyDay, elapsed) }), asOf, estimated: true }
}
export function captureBasis(d: Liability, at: string, reason: string): LoanBasis {
  return { id: crypto.randomUUID(), at, reason, currency: d.currency, balance: d.balance,
    ...(d.annualRate !== undefined && { annualRate: d.annualRate }),
    ...(d.remainingInstallments !== undefined && { remainingInstallments: d.remainingInstallments }),
    ...(d.repaymentMethod !== undefined && { repaymentMethod: d.repaymentMethod }),
    ...(d.schedule && { schedule: { ...d.schedule } }) }
}
