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
// One worker tries each candidate; passwords never enter persisted import data.
export function statementPasswordHandler(passwordText:string) {
  const passwords = [...new Set(passwordText.split(',').map(p=>p.trim()).filter(Boolean))]
  let index = 0
  return (update:(value:string|Error)=>void) => update(index < passwords.length ? passwords[index++] : new Error('帳單需要密碼，或提供的密碼均不正確。'))
}

export function statementMetadata(lines:string[], title = '', fileName = ''): {bank?:string;month?:string;monthSource?:string} {
  const identify = (text:string) => {
    const compact = text.normalize('NFKC').replace(/\s/g,'')
    const banks = [[/玉山|E\.?SUN/i,'玉山'],[/富邦|FUBON/i,'富邦'],[/HSBC|滙豐|匯豐/i,'匯豐']] as const
    const matches = banks.filter(([pattern])=>pattern.test(compact))
    return matches.length === 1 ? matches[0][1] : undefined
  }
  const bank = identify(title) ?? lines.slice(0,10).map(identify).find(Boolean) ?? identify(fileName) ?? identify(lines.join(' '))
  const yearMonth = (year:string,month:string) => {
    const y = Number(year)+(year.length === 3 ? 1911 : 0), m = Number(month)
    return y >= 1900 && y <= 9999 && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2,'0')}` : undefined
  }
  // Only explicit statement headings/dates count; payment deadlines and advertising dates do not.
  for(const heading of [title,...lines.slice(0,20).filter(l=>/信用卡|帳單|對帳單/.test(l))]) {
    const match = heading.normalize('NFKC').match(/(\d{3,4})\s*年\s*(\d{1,2})\s*月/)
    if(match) {const month=yearMonth(match[1],match[2]);if(month) return {bank,month,monthSource:'帳單標題'}}
  }
  for(let i=0;i<Math.min(lines.length,20);i++) {
    const line=lines[i].normalize('NFKC')
    const labels=[...line.matchAll(/結帳日(?:期)?|帳單日期|繳款截止日(?:期)?|繳款期限/g)]
    const index=labels.findIndex(m=>/結帳|帳單日期/.test(m[0]))
    if(index < 0) continue
    const dates=[...(line.match(/\d{3,4}[/.-]\d{1,2}[/.-]\d{1,2}/g) ?? [])]
    const values=dates.length ? dates : (lines[i+1]?.normalize('NFKC').match(/\d{3,4}[/.-]\d{1,2}[/.-]\d{1,2}/g) ?? [])
    if(values.length !== labels.length) continue
    const [year,m,d]=values[index].split(/[/.-]/)
    const month=yearMonth(year,m)
    if(month && validDate(`${month}-${d.padStart(2,'0')}`)) return {bank,month,monthSource:'帳單結帳日'}
  }
  const match=fileName.match(/(?:^|\D)(20\d{2})[-_](0[1-9]|1[0-2])(?:\D|$)/)
  return {bank,...(match?{month:yearMonth(match[1],match[2]),monthSource:'檔名'}:{})}
}

export function assertCreditCardFile(name:string) {
  if(/證券|证券|綜合月對帳單|综合月对账单/.test(name)) throw new Error('證券對帳單不支援：請選擇信用卡帳單')
}
export function parseStatement(lines:string[], month:string, currency:string, fileName = ''): {rows:StatementRow[];skipped:string[];review:number[]} {
  assertCreditCardFile(fileName)
  const text = lines.join(' ').replace(/\s/g,'')
  if(/綜合月對帳單|综合月对账单/.test(text) || (/成交日期/.test(text) && /買賣別|證券帳號/.test(text))) throw new Error('證券對帳單不支援：請選擇信用卡帳單')
  const detected = statementMetadata(lines,'',fileName).bank
  const bank = detected === '富邦' ? 'fubon' : detected === '玉山' ? 'esun' : detected === '匯豐' ? 'hsbc' : null
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
