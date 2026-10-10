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
export function assertCreditCardFile(name:string) {
  if(/證券|证券|綜合月對帳單|综合月对账单/.test(name)) throw new Error('證券對帳單不支援：請選擇信用卡帳單')
}
export function parseStatement(lines:string[], month:string, currency:string, fileName = ''): {rows:StatementRow[];skipped:string[];review:number[]} {
  assertCreditCardFile(fileName)
  const text = lines.join(' ').replace(/\s/g,'')
  if(/綜合月對帳單|综合月对账单/.test(text) || (/成交日期/.test(text) && /買賣別|證券帳號/.test(text))) throw new Error('證券對帳單不支援：請選擇信用卡帳單')
  const bank = /富邦/.test(fileName+text)?'fubon':/玉山/.test(fileName+text)?'esun':/HSBC|滙豐|匯豐/i.test(fileName+text)?'hsbc':null
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('請填寫有效的帳單月份')
  if(!/^[A-Z]{3}$/.test(currency)) throw new Error('請填寫三碼幣別')
  const rows:StatementRow[] = [], skipped:string[] = [], review:number[] = []
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
    if(bank === 'hsbc' && !posting) {skipped.push(original);continue}
    const amountMatch = line.match(/(?:^|\s+)(?:NT\$|TWD|\$)?\s*(\(?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\)?)(?:\s*(CR|DR))?$/i)
    if(!validDate(date) || !amountMatch) {skipped.push(original);continue}
    let description = line.slice(0,amountMatch.index).trim()
    if(bank === 'fubon') {
      // The posting date separates the merchant from original-currency metadata.
      const middlePosting = description.search(/\s\d{3,4}[/.-]\d{1,2}[/.-]\d{1,2}(?:\s|$)/)
      if(middlePosting >= 0) description = description.slice(0,middlePosting).trim()
    }
    if(bank === 'esun' || bank === 'hsbc') {
      description = description.split(/\s(?:TWD|NTD|USD|SGD|HKD|JPY|EUR)\s+[+-]?\d/i)[0].trim()
      description = description.replace(/\s\d{1,2}[/.-]\d{1,2}$/, '').trim()
    }
    if(bank === 'hsbc' && (!description || !/[\p{L}]/u.test(description) || /^[A-Z]{3}$/i.test(description))) {
      description = '商家未能辨識（請對照帳單填寫；可能包含繳款）'
      review.push(rows.length)
    }
    // shortcut: unknown bank layouts require a single unambiguous amount; add verified layouts when samples are available.
    if(!description || (!bank && /\s[+-]?\d[\d,.]*\s*$/.test(description))) {skipped.push(original);continue}
    let amount = Number(amountMatch[1].replace(/[(),]/g,''))
    if(amountMatch[1].startsWith('(') || amountMatch[2]?.toUpperCase() === 'CR') amount = -Math.abs(amount)
    if(!Number.isFinite(amount)) {skipped.push(original);continue}
    rows.push({date,description,amount,currency:bank === 'fubon' || bank === 'esun' ? 'TWD' : currency})
  }
  return {rows,skipped,review}
}
