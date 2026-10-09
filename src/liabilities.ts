import { BASE_CURRENCY, accountBaseValue, rateOf, type WealthData } from './model'
import { REPAYMENT_METHODS, validateLoanInputs, type RepaymentMethod } from './loanEstimate'
import { isSupportedCurrency } from './currencies'

export const LIABILITY_KINDS = { mortgage: '房貸', personal: '信貸', credit: '信用卡', other: '其他' }
export type LiabilityKind = keyof typeof LIABILITY_KINDS
export interface Liability {
  id: string
  name: string
  kind: LiabilityKind
  currency: string
  balance: number // Current outstanding principal/balance, always non-negative.
  annualRate?: number // Percent; used for projection only, never to update actual debt.
  repaymentMethod?: RepaymentMethod // Absent on legacy records: no projection.
  remainingInstallments?: number
  paymentAmount?: number // Per-payment amount, NOT the outstanding balance.
  nextDueDate?: string // YYYY-MM-DD, without timezone conversion.
  totalInstallments?: number
  paidInstallments?: number
  notes?: string
}

export function parseLiability(raw: unknown): Liability {
  const fail = (message: string): never => { throw new Error(message) }
  if (typeof raw !== 'object' || raw === null) return fail('負債必須是物件')
  const r = raw as Record<string, unknown>
  const text = (key: string) => typeof r[key] === 'string' ? (r[key] as string).trim() : ''
  const id = text('id'), name = text('name'), currency = text('currency').toUpperCase()
  if (!id || !name) fail('負債缺少識別碼或名稱')
  if (typeof r.kind !== 'string' || !Object.hasOwn(LIABILITY_KINDS, r.kind)) fail('請選擇有效的負債類型')
  if (!isSupportedCurrency(currency)) fail('請輸入支援的幣別代碼')
  const number = (key: string, label: string, required = false, integer = false, minimum = 0): number | undefined => {
    const v = r[key]
    if (v === undefined && !required) return undefined
    if (typeof v !== 'number' || !Number.isFinite(v) || v < minimum || (integer && !Number.isSafeInteger(v))) fail(`${label}必須是${integer ? '整數' : '有限數字'}且不得小於 ${minimum}`)
    return v as number
  }
  const balance = number('balance', '目前未償餘額', true)!
  const annualRate = number('annualRate', '年利率')
  const remainingInstallments = number('remainingInstallments', '剩餘期數', false, true, 1)
  const repaymentMethod = r.repaymentMethod
  if (repaymentMethod !== undefined && (typeof repaymentMethod !== 'string' || !Object.hasOwn(REPAYMENT_METHODS, repaymentMethod))) fail('請選擇有效的還款方式')
  if (repaymentMethod === 'annuity' || repaymentMethod === 'equalPrincipal') {
    if (r.kind === 'credit') fail('信用卡請使用只記錄餘額模式，不套用貸款公式')
    validateLoanInputs({ principal: balance, annualRate: annualRate ?? NaN, periods: remainingInstallments ?? NaN, method: repaymentMethod })
  }
  const paymentAmount = number('paymentAmount', '每期應付')
  const totalInstallments = number('totalInstallments', '總期數', false, true, 1)
  const paidInstallments = number('paidInstallments', '已繳期數', false, true)
  if (totalInstallments !== undefined && paidInstallments !== undefined && paidInstallments > totalInstallments) fail('已繳期數不能超過總期數')
  const nextDueDate = text('nextDueDate')
  if (r.nextDueDate !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(nextDueDate) || nextDueDate.slice(0, 4) === '0000' || !Number.isFinite(Date.parse(`${nextDueDate}T00:00:00Z`)) || new Date(`${nextDueDate}T00:00:00Z`).toISOString().slice(0, 10) !== nextDueDate)) fail('下次到期日必須是有效日期')
  if (r.notes !== undefined && typeof r.notes !== 'string') fail('備註必須是文字')
  return {
    id, name, kind: r.kind as LiabilityKind, currency, balance,
    ...(annualRate !== undefined && { annualRate }),
    ...(repaymentMethod !== undefined && { repaymentMethod: repaymentMethod as RepaymentMethod }),
    ...(remainingInstallments !== undefined && { remainingInstallments }),
    ...(paymentAmount !== undefined && { paymentAmount }),
    ...(nextDueDate && { nextDueDate }),
    ...(totalInstallments !== undefined && { totalInstallments }),
    ...(paidInstallments !== undefined && { paidInstallments }),
    ...(text('notes') && { notes: text('notes') }),
  }
}

export const liabilityBaseValue = (data: WealthData, liability: Liability) =>
  liability.balance === 0 ? 0 : liability.balance * rateOf(data, liability.currency)

export function balanceSheet(data: WealthData): { assets: number | null; liabilities: number | null; net: number | null; missing: string[] } {
  const validRate = (currency: string) => Number.isFinite(rateOf(data, currency)) && rateOf(data, currency) > 0
  const assetMissing = data.accounts.flatMap((a) => a.positions.filter((p) => p.quantity !== 0 && !validRate(p.currency)).map((p) => p.currency))
  const debtMissing = (data.liabilities ?? []).filter((d) => d.balance !== 0 && !validRate(d.currency)).map((d) => d.currency)
  const assetSum = data.accounts.reduce((sum, a) => sum + accountBaseValue(data, a), 0)
  const debtSum = (data.liabilities ?? []).reduce((sum, d) => sum + liabilityBaseValue(data, d), 0)
  const assets = assetMissing.length || !Number.isFinite(assetSum) ? null : assetSum
  const liabilities = debtMissing.length || !Number.isFinite(debtSum) ? null : debtSum
  const difference = assets !== null && liabilities !== null ? assets - liabilities : NaN
  return { assets, liabilities, net: Number.isFinite(difference) ? difference : null, missing: [...new Set([...assetMissing, ...debtMissing])].filter((c) => c !== BASE_CURRENCY) }
}
