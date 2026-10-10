// Imports rows copied from the user's existing asset spreadsheet (tab-separated).
// Expected columns: 機構, 類別, 子類別, 幣別, 數量, 單價, 原幣市值, 匯率, 台幣市值, 佔比, 用途

import { isSupportedCurrency } from './currencies'
import { BASE_CURRENCY, newId, type Account, type WealthData } from './model'

const COUNTRY_SUFFIX = /\s+(TW|SG|US|JP|HK|UK|CN)$/i
const COUNTRY_BY_CATEGORY: [RegExp, string][] = [
  [/台股/, 'TW'],
  [/美股/, 'US'],
  [/新股/, 'SG'],
]

// Name suffix first ("HSBC SG"), then the market in the category, then Chinese names as Taiwan.
function guessCountry(name: string, category: string): string {
  const suffix = name.match(COUNTRY_SUFFIX)?.[1]
  if (suffix) return suffix.toUpperCase()
  for (const [re, code] of COUNTRY_BY_CATEGORY) if (re.test(category)) return code
  return /[\u4e00-\u9fff]/.test(name) ? 'TW' : ''
}

function toNumber(cell: string | undefined): number {
  const value = (cell ?? '').replace(/[$,\s]/g, '')
  return value && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : NaN
}

export interface ImportResult {
  data: WealthData
  accounts: number
  rows: number
  skipped: number
  errors: { line: number; message: string }[]
  replaced: Account[]
  rateChanges: { currency: string; before: number | undefined; after: number }[]
}

// Rows with the same 機構 become one account. An account with the same name as an
// existing one has its positions replaced; exchange rates in the sheet overwrite stored ones.
export function importSheet(data: WealthData, text: string): ImportResult {
  const imported = new Map<string, Account>()
  const fxRates = { ...data.fxRates }
  let rows = 0
  const errors: ImportResult['errors'] = []
  const seenRates = new Map<string, number>()

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const cells = line.split('\t').map((c) => c.trim())
    const [name, category, , rawCurrency] = cells
    const accountKey = name.toUpperCase()
    const currency = (rawCurrency ?? '').toUpperCase()
    const quantity = toNumber(cells[4])
    const price = cells[5] ? toNumber(cells[5]) : 1
    const rate = cells[7] ? toNumber(cells[7]) : undefined
    const reasons: string[] = []
    if (!name) reasons.push('缺少機構名稱')
    if (!isSupportedCurrency(currency)) reasons.push(`不支援的幣別「${currency}」`)
    if (!Number.isFinite(quantity)) reasons.push('數量必須是有效數字且不可空白')
    if (!Number.isFinite(price) || price < 0) reasons.push('單價必須是非負有限數字')
    if (!Number.isFinite(quantity * price)) reasons.push('市值超出有效數字範圍')
    if (rate !== undefined && (!Number.isFinite(rate) || rate <= 0)) reasons.push('匯率必須是正有限數字')
    if (currency === BASE_CURRENCY && rate !== undefined && rate !== 1) reasons.push('台幣匯率必須為 1')
    if (data.accounts.filter((a) => a.name.trim().toUpperCase() === accountKey).length > 1) reasons.push('同名帳戶有多筆，表格未提供國家，請使用帳戶頁編輯以免套用到錯誤帳戶')
    if (rate !== undefined && seenRates.has(currency) && seenRates.get(currency) !== rate) reasons.push('同幣別有不同匯率')
    if (reasons.length) {
      errors.push({ line: index + 1, message: reasons.join('；') })
      continue
    }
    rows++
    if (rate !== undefined) {
      seenRates.set(currency, rate)
      if (currency !== BASE_CURRENCY) fxRates[currency] = rate
    }

    const isCash = (category ?? '').includes('現金')
    let account = imported.get(accountKey)
    if (!account) {
      const existing = data.accounts.find((a) => a.name.trim().toUpperCase() === accountKey)
      account = {
        id: existing?.id ?? newId(),
        name,
        kind: isCash ? 'bank' : 'investment',
        country: existing?.country || guessCountry(name, category ?? ''),
        category: category || existing?.category || '其他',
        positions: [],
      }
      imported.set(accountKey, account)
    }
    if (!isCash) account.kind = 'investment'
    // The sheet tracks investment accounts by total value, so keep that as one
    // holding the user can later split into individual securities.
    account.positions.push(
      isCash
        ? { id: newId(), type: 'cash', currency, symbol: '', quantity: quantity * price, price: 1 }
        : { id: newId(), type: 'holding', currency, symbol: cells[2] || category || '市值', quantity, price, priceManual: true },
    )
  }

  const accounts = data.accounts.map((a) => imported.get(a.name.trim().toUpperCase()) ?? a)
  for (const a of imported.values()) if (!data.accounts.some((x) => x.name.trim().toUpperCase() === a.name.trim().toUpperCase())) accounts.push(a)

  const rateChanges = Object.entries(fxRates)
    .filter(([currency, after]) => data.fxRates[currency] !== after)
    .map(([currency, after]) => ({ currency, before: data.fxRates[currency], after }))
  return {
    // An invalid batch is never partly applied, even by a non-UI caller.
    data: errors.length || !rows ? data : { ...data, fxRates, accounts },
    accounts: imported.size, rows, skipped: errors.length, errors,
    replaced: data.accounts.filter((a) => imported.has(a.name.trim().toUpperCase())),
    rateChanges,
  }
}
