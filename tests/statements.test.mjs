import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

let server, statements, expenses, model, history, saveState
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  statements = await server.ssrLoadModule('/src/statements.ts')
  expenses = await server.ssrLoadModule('/src/expenses.ts')
  model = await server.ssrLoadModule('/src/model.ts')
  history = await server.ssrLoadModule('/src/history.ts')
  saveState = await server.ssrLoadModule('/src/saveState.ts')
})
after(() => server?.close())
const lines = ['消費日 入帳日 商店名稱 臺幣金額', '09/01 09/03 SHOP ONE 1,200', '09/02 09/04 SHOP TWO 300.50', '09/03 09/05 SHOP REFUND -100', '09/04 09/06 自動轉帳繳款 -2,000', '本期應繳總額 1,400.50']
const parse = (text = lines, month = '2026-09') => statements.parseStatement(text, month, 'TWD')
const row = (description = 'SHOP ONE') => ({date:'2026-09-01', description, amount:1200, currency:'TWD'})
const prepare = async (rows = parse().rows, fileHash = 'a'.repeat(64)) => expenses.prepareExpenses(rows, '合成銀行 / 卡片A', fileHash)

test('extract transaction rows, preserve refunds, exclude repayments and summaries', () => {
  const result = parse()
  assert.equal(result.rows.length, 3)
  assert.deepEqual(result.rows[0], row())
  assert.equal(result.rows[1].amount, 300.5)
  assert.equal(result.rows[2].amount, -100)
  assert.ok(result.skipped.some(line => line.includes('繳款')))
})

test('year rollover and ROC years are resolved; impossible dates and ambiguous amounts are not guessed', () => {
  const result = parse(['12/30 01/02 STORE 100', '115/01/03 SHOP 200', '02/30 INVALID 30', '01/05 FOREIGN USD 10.00 320.00'], '2026-01')
  assert.deepEqual(result.rows.map(r => r.date), ['2025-12-30', '2026-01-03'])
  assert.equal(result.skipped.length, 2)
  assert.throws(() => parse([], '2026-13'), /月份/)
})

test('positioned PDF text is ordered into rows; unsupported scans fail visibly', () => {
  const item = (str,x,y) => ({str, transform:[1,0,0,1,x,y]})
  assert.deepEqual(statements.textLines([item('100',300,100),item('STORE',100,100),item('09/01',0,100),item('SECOND',100,80)]), ['09/01 STORE 100','SECOND'])
})

test('reimports of the same file and edited previews are idempotent; identical genuine purchases survive', async () => {
  const prepared = await prepare([row(),row()])
  assert.notEqual(prepared[0].importKey, prepared[1].importKey)
  const first = expenses.mergeExpenses([], prepared)
  assert.equal(first.added, 2)
  const edited = first.expenses.map(e => ({...e, description:'Corrected merchant', amount:1100}))
  assert.equal(expenses.mergeExpenses(edited, prepared).added, 0)
  const anotherPdf = await prepare([row(),row()], 'b'.repeat(64))
  assert.equal(expenses.mergeExpenses(edited, anotherPdf).added, 0)
  const otherCard = prepared.map(e => ({...e, card:'another card', sourceKey:undefined, importKey:undefined}))
  assert.equal(expenses.mergeExpenses(first.expenses, otherCard).added, 2)
})

test('edited rows are rechecked against existing transactions; invalid batch is atomic', async () => {
  const existing = expenses.mergeExpenses([], await prepare([row()])).expenses
  const corrected = (await prepare([row('WRONG')], 'b'.repeat(64))).map(e => ({...e,description:'SHOP ONE'}))
  assert.equal(expenses.mergeExpenses(existing, corrected).added,0)
  assert.throws(() => expenses.mergeExpenses(existing,[...corrected,{...corrected[0],amount:NaN}]), /金額/)
  assert.equal(existing.length,1)
})

test('partial import of identical purchases can later import the missing occurrence, with known rows unchecked',async()=>{
  const rows = await prepare([row(),row()])
  const existing = expenses.mergeExpenses([],[rows[1]]).expenses
  assert.equal(expenses.mergeExpenses(existing,rows).added,1)
  assert.equal(expenses.mergeExpenses(existing,[rows[0]],rows).added,1)
  const anotherFile = await prepare([row(),row()],'b'.repeat(64))
  assert.equal(expenses.mergeExpenses(existing,[anotherFile[0]],anotherFile).added,1)
})

test('v10 records roundtrip, validate imports and remain v10 through saves and concurrent edits', async () => {
  const data = {...model.emptyData(),version:10,expenses:(await prepare([row()]))}
  assert.deepEqual(model.parseWealthData(JSON.parse(JSON.stringify(data))).expenses,data.expenses)
  assert.throws(() => model.parseWealthData({...data,expenses:[{...data.expenses[0],date:'2026-02-30'}]}),/日期/)
  assert.throws(() => model.parseWealthData({...data,expenses:[data.expenses[0],data.expenses[0]]}),/識別碼/)
  assert.throws(() => model.parseWealthData({...data,expenses:undefined}),/消費/)
  const persisted = history.recordSave(null,data)
  assert.equal(persisted.version,10)
  const current = {...data,expenses:[]}
  assert.deepEqual(saveState.finishSave(current,data,persisted).expenses,[])
  assert.equal(saveState.finishSave(current,data,persisted).version,10)
  assert.equal(model.parseWealthData(model.emptyData()).expenses,undefined)
  const quantity = await server.ssrLoadModule('/src/quantityHistory.ts')
  const next = quantity.applyQuantityDay(data,{date:'2025-09-01',updatedAt:'2025-09-01T12:00:00Z',entries:[]})
  assert.equal(next.version,10)
  assert.deepEqual(next.expenses,data.expenses)
})

async function pdfLines(name,password) {
  const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({data:new Uint8Array(await readFile(new URL(`./fixtures/${name}`,import.meta.url))),password,
    cMapUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/cmaps/',import.meta.url)),
    standardFontDataUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url)),verbosity:0})
  try {
    const pdf = await task.promise, page = await pdf.getPage(1)
    return statements.textLines((await page.getTextContent()).items)
  } finally {await task.destroy()}
}

test('real synthetic encrypted PDF rejects wrong password and yields transactions with the right password',async()=>{
  await assert.rejects(()=>pdfLines('synthetic-statement-encrypted.pdf','wrong'),{name:'PasswordException'})
  const result = parse(await pdfLines('synthetic-statement-encrypted.pdf','fixture-password'))
  assert.equal(result.rows.length,4)
  assert.deepEqual(result.rows.slice(0,2),[row(),row()])
  assert.equal(result.rows[3].amount,-100)
})

test('CJK PDF character maps preserve Chinese names and exclude repayment; textless PDFs yield no rows',async()=>{
  const result = parse(await pdfLines('synthetic-statement-cjk.pdf'))
  assert.deepEqual(result.rows.map(r=>r.description),['合成商店','合成退款'])
  assert.equal(result.rows[1].amount,-100)
  assert.deepEqual(await pdfLines('synthetic-scan.pdf'),[])
  assert.equal(parse(await pdfLines('synthetic-statement.pdf')).rows.length,4)
})


test('Fubon ROC posting columns and E.SUN original amounts use the final billed TWD amount',()=>{
  const fubon = statements.parseStatement(['消費日期 消費明細 入帳日期 外幣金額 台幣金額',
    '115/04/01 自動轉帳繳款 115/04/02 -5,000',
    '115/04/03 合成旅遊商店 115/04/05 1150404/ HKD 50.30/ NLD 205',
    '115/04/06 合成商店 123 分店 115/04/08 TWD 25'], '2026-04','USD','富邦信用卡.pdf')
  assert.deepEqual(fubon.rows,[{date:'2026-04-03',description:'合成旅遊商店',amount:205,currency:'TWD'},
    {date:'2026-04-06',description:'合成商店 123 分店',amount:25,currency:'TWD'}])
  const esun = statements.parseStatement(['消費日 入帳日 消費明細 幣別',
    '11/01 11/02 合成海外商店 11/02 USD 10.00 TWD 320',
    '11/03 11/04 合成退款 TWD -100',
    '11/05 感謝您辦理自動轉帳繳款 TWD -900'],'2025-11','USD','玉山信用卡.pdf')
  assert.deepEqual(esun.rows,[{date:'2025-11-01',description:'合成海外商店',amount:320,currency:'TWD'},
    {date:'2025-11-03',description:'合成退款',amount:-100,currency:'TWD'}])
})

test('HSBC unreadable merchant rows require review; foreign source amount never replaces billed TWD',()=>{
  const result=statements.parseStatement(['04/01 04/02 1,200', '04/03 04/04 USA USD 10.00 04/04 320'],'2026-04','TWD','HSBC信用卡.pdf')
  assert.deepEqual(result.rows.map(r=>[r.amount,r.currency]),[[1200,'TWD'],[320,'TWD']])
  assert.deepEqual(result.review,[0,1])
  assert.ok(result.rows.every(r=>r.description.includes('未能辨識')))
})

test('securities statements are rejected by filename and strong content markers, not credit-card ads',()=>{
  assert.throws(()=>statements.assertCreditCardFile('台新證券綜合月對帳單.pdf'),/證券/)
  assert.throws(()=>parse(['綜合月對帳單','成交日期 買賣別 證券帳號']),/證券/)
  assert.doesNotThrow(()=>parse(['信用卡優惠與證券廣告',...lines]))
})
