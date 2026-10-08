// Imports rows copied from the user's existing asset spreadsheet (tab-separated).
// Expected columns: 機構, 類別, 子類別, 幣別, 數量, 單價, 原幣市值, 匯率, 台幣市值, 佔比, 用途

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
  return Number((cell ?? '').replace(/[$,\s%]/g, ''))
}

export interface ImportResult {
  data: WealthData
  accounts: number
  rows: number
  skipped: number
}

// Rows with the same 機構 become one account. An account with the same name as an
// existing one has its positions replaced; exchange rates in the sheet overwrite stored ones.
export function importSheet(data: WealthData, text: string): ImportResult {
  const imported = new Map<string, Account>()
  const fxRates = { ...data.fxRates }
  let rows = 0
  let skipped = 0

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells = line.split('\t').map((c) => c.trim())
    const [name, category, , rawCurrency] = cells
    const currency = (rawCurrency ?? '').toUpperCase()
    const quantity = toNumber(cells[4])
    const price = cells[5] ? toNumber(cells[5]) : 1
    if (!name || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(quantity) || !Number.isFinite(price)) {
      skipped++
      continue
    }
    rows++

    const rate = toNumber(cells[7])
    if (currency !== BASE_CURRENCY && rate > 0) fxRates[currency] = rate

    const isCash = (category ?? '').includes('現金')
    let account = imported.get(name)
    if (!account) {
      const existing = data.accounts.find((a) => a.name === name)
      account = {
        id: existing?.id ?? newId(),
        name,
        kind: isCash ? 'bank' : 'investment',
        country: existing?.country || guessCountry(name, category ?? ''),
        category: category || existing?.category || '其他',
        purpose: cells[10] || existing?.purpose || '',
        positions: [],
      }
      imported.set(name, account)
    }
    // The sheet tracks investment accounts by total value, so keep that as one
    // holding the user can later split into individual securities.
    account.positions.push(
      isCash
        ? { id: newId(), type: 'cash', currency, symbol: '', quantity: quantity * price, price: 1 }
        : { id: newId(), type: 'holding', currency, symbol: cells[2] || category || '市值', quantity, price },
    )
  }

  const accounts = data.accounts.map((a) => imported.get(a.name) ?? a)
  for (const a of imported.values()) if (!data.accounts.some((x) => x.name === a.name)) accounts.push(a)

  return { data: { ...data, fxRates, accounts }, accounts: imported.size, rows, skipped }
}
