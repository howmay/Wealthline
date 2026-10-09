// Monthly projections, not actual ledger updates. Formulas and assumptions:
// https://www.landbank.com.tw/Calculate/Repayment
export const REPAYMENT_METHODS = { annuity: '本息平均攤還', equalPrincipal: '本金平均攤還', none: '只記錄餘額／不試算' }
export type RepaymentMethod = keyof typeof REPAYMENT_METHODS
export type AmortizingMethod = Exclude<RepaymentMethod, 'none'>
export const MAX_LOAN_PERIODS = 1200
export interface LoanInputs { principal: number; annualRate: number; periods: number; method: AmortizingMethod }
export interface LoanPeriod {
  period: number
  openingBalance: number
  principal: number
  interest: number
  payment: number
  closingBalance: number
}
export interface LoanEstimate {
  rows: LoanPeriod[]
  regularPayment: number | null // Equal-principal loans do NOT have a fixed payment.
  totalPrincipal: number
  totalInterest: number
  totalPayment: number
}

export function validateLoanInputs(input: LoanInputs): void {
  if (!Number.isFinite(input.principal) || input.principal < 0) throw new Error('目前剩餘本金必須是非負有限數字')
  if (!Number.isFinite(input.annualRate) || input.annualRate < 0) throw new Error('年利率必須是非負有限數字')
  if (!Number.isSafeInteger(input.periods) || input.periods < 1 || input.periods > MAX_LOAN_PERIODS) throw new Error(`剩餘期數必須是 1 至 ${MAX_LOAN_PERIODS} 的整數（月）`)
  if (input.method !== 'annuity' && input.method !== 'equalPrincipal') throw new Error('此還款方式不適用分期試算')
}

export function estimateLoan(input: LoanInputs): LoanEstimate {
  validateLoanInputs(input)
  const { principal: original, periods, method } = input
  const rate = input.annualRate / 1200
  const logRate = Math.log1p(rate)
  // Equivalent to P*r/(1-(1+r)^-n). expm1 avoids cancellation at tiny rates;
  // the negative exponent avoids overflow for large n. 0% has its own limit.
  const payment = rate === 0 ? original / periods : original * (rate / -Math.expm1(-periods * logRate))
  const principalPart = original / periods
  let balance = original, totalInterest = 0, compensation = 0
  const rows: LoanPeriod[] = []
  for (let i = 0; i < periods; i++) {
    const interest = balance * rate
    // A/(1+r)^(remaining periods) equals A-interest, without subtracting
    // nearly equal numbers when early principal repayments are very small.
    const scheduledPrincipal = method === 'annuity' && rate !== 0 ? payment * Math.exp(-(periods - i) * logRate) : principalPart
    const principal = i === periods - 1 ? balance : Math.min(balance, Math.max(0, scheduledPrincipal))
    const closingBalance = i === periods - 1 ? 0 : Math.max(0, balance - principal)
    const due = principal + interest
    if (![principal, interest, due, closingBalance].every(Number.isFinite)) throw new Error('金額或利率超出可可靠試算的範圍，請檢查輸入')
    rows.push({ period: i + 1, openingBalance: balance, principal, interest, payment: due, closingBalance })
    // Compensated sum: no n*payment - principal cancellation at low rates.
    const y = interest - compensation
    const sum = totalInterest + y
    compensation = (sum - totalInterest) - y
    totalInterest = sum
    balance = closingBalance
  }
  const totalPayment = original + totalInterest
  if (!Number.isFinite(totalPayment) || !Number.isFinite(payment)) throw new Error('金額或利率超出可可靠試算的範圍，請檢查輸入')
  return { rows, regularPayment: method === 'annuity' ? payment : null, totalPrincipal: original, totalInterest, totalPayment }
}
