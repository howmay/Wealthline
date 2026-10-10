import { validDate } from './quantityHistory'
import type { StatementRow } from './expenses'

interface TextItem { str:string; transform:number[] }
export function textLines(items: unknown[]): string[] {
  const rows: {y:number; items:{x:number;str:string}[]}[] = []
  for (const raw of items) {
    const item = raw as TextItem
    if (typeof item.str !== 'string' || !item.str.trim() || !Array.isArray(item.transform)) continue
    const x = item.transform[4], y = item.transform[5]
    let row = rows.find(r => Math.abs(r.y-y) <= 2)
    if (!row) {row = {y,items:[]}; rows.push(row)}
    row.items.push({x,str:item.str})
  }
  return rows.sort((a,b) => b.y-a.y).map(r => r.items.sort((a,b) => a.x-b.x).map(i => i.str).join(' ').replace(/\s+/g,' ').trim())
}

const datePattern = /^(?:(\d{3,4})[/.-])?(\d{1,2})[/.-](\d{1,2})(?:\s+|$)/
const nonSpending = /繳款|繳費|轉帳扣款|自動扣繳|上期|前期|應繳|最低應繳|總額|小計|合計|PAYMENT|BALANCE|TOTAL/i
export function parseStatement(lines:string[], month:string, currency:string): {rows:StatementRow[];skipped:string[]} {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('請填寫有效的帳單月份')
  if(!/^[A-Z]{3}$/.test(currency)) throw new Error('請填寫三碼幣別')
  const rows:StatementRow[] = [], skipped:string[] = []
  for (const original of lines) {
    let line = original.normalize('NFKC').trim()
    const match = line.match(datePattern)
    if (!match) { if (/\d/.test(line)) skipped.push(original); continue }
    if(nonSpending.test(line)) {skipped.push(original);continue}
    const m = Number(match[2]), d = Number(match[3])
    let year = match[1] ? Number(match[1]) : Number(month.slice(0,4))
    if(match[1]?.length === 3) year += 1911
    if(!match[1] && m > Number(month.slice(5))) year--
    const date = `${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    line = line.slice(match[0].length)
    // Some statements have posting date in a second column.
    const posting = line.match(datePattern)
    if(posting) line = line.slice(posting[0].length)
    const amountMatch = line.match(/\s+(?:NT\$|TWD|\$)?\s*(\(?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\)?)(?:\s*(CR|DR))?$/i)
    if(!validDate(date) || !amountMatch) {skipped.push(original);continue}
    const description = line.slice(0,amountMatch.index).trim()
    // shortcut: only unambiguous single-amount text rows; add bank-specific layouts with real anonymized fixtures.
    if(!description || /\s[+-]?\d[\d,.]*\s*$/.test(description)) {skipped.push(original);continue}
    let amount = Number(amountMatch[1].replace(/[(),]/g,''))
    if(amountMatch[1].startsWith('(') || amountMatch[2]?.toUpperCase() === 'CR') amount = -Math.abs(amount)
    if(!Number.isFinite(amount)) {skipped.push(original);continue}
    rows.push({date,description,amount,currency})
  }
  return {rows,skipped}
}
