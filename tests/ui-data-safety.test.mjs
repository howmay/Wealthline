import assert from 'node:assert/strict'
import { after, before, afterEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement, useState, useEffect } from 'react'

let server, root, dom, App, Accounts, Liabilities, Overview, HistoryView, SaveReview, model, auth, createRoot
const originalFetch = globalThis.fetch
const token = { value: 'test-token', expiresAt: Date.now() + 3600_000 }
const profile = { sub: 'account-a', email: 'a@example.com', name: 'Alice' }
before(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://wealthline.test/rates' })
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'MouseEvent', 'PopStateEvent', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  window.scrollTo = () => {}
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  App = (await server.ssrLoadModule('/src/App.tsx')).default
  ;({ Accounts } = await server.ssrLoadModule('/src/views/Accounts.tsx'))
  ;({ Liabilities } = await server.ssrLoadModule('/src/views/Liabilities.tsx'))
  ;({ Overview } = await server.ssrLoadModule('/src/views/Overview.tsx'))
  ;({ HistoryView } = await server.ssrLoadModule('/src/views/History.tsx'))
  ;({ SaveReview } = await server.ssrLoadModule('/src/views/SaveReview.tsx'))
  model = await server.ssrLoadModule('/src/model.ts')
  auth = await server.ssrLoadModule('/src/google/auth.ts')
})
afterEach(async () => {
  const {clearHistoryCache}=await server.ssrLoadModule('/src/priceHistory.ts');clearHistoryCache()
  if (root) await act(() => root.unmount())
  root = null
  globalThis.fetch = originalFetch
  localStorage.clear()
  sessionStorage.clear()
  delete globalThis.confirm
  window.history.replaceState(null, '', '/rates')
})
after(async () => { await server.close(); dom.window.close() })
const render = async (component, props = {}) => {
  if (!root) root = createRoot(document.getElementById('root'))
  await act(async () => { root.render(createElement(component, props)) })
}
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)
const click = async (element) => { assert.ok(element); await act(async () => element.click()) }
const setInput = async (input, value) => {
  await act(async () => {
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const editRate = async (currency, value) => {
  const input = document.querySelector(`[aria-label="${currency} 匯率"]`)
  assert.ok(input)
  await act(async () => input.focus())
  await setInput(input, value)
  await act(async () => input.blur())
}
const fixture = () => ({ ...model.emptyData(), fxRates: { USD: 32, SGD: 24 }, fxUpdatedAt: new Date().toISOString() })
const setupDrive = (data) => {
  let resolveWrite, writes = 0, uploaded, uploadedEtag
  globalThis.fetch = async (url, init = {}) => {
    if (url.includes('userinfo')) return Response.json(profile)
    if (init.method === 'PUT') {
      writes++
      uploaded = JSON.parse(init.body)
      uploadedEtag = init.headers['If-Match']
      return new Promise((resolve) => { resolveWrite = resolve })
    }
    if (new URL(url).searchParams.has('q')) return Response.json({ files: [{ id: 'f' }] })
    if (new URL(url).searchParams.has('alt')) return Response.json(data)
    return Response.json({ id: 'f', etag: '"v1"', headRevisionId: 'r1' })
  }
  auth.storeSession({ token, profile })
  return {
    finish: async (status = 200) => act(async () => resolveWrite(status === 200 ? Response.json({ id: 'f', etag: '"v2"' }) : new Response('', { status }))),
    get writes() { return writes },
    get uploaded() { return uploaded },
    get uploadedEtag() { return uploadedEtag },
  }
}

test('editing another rate during a deferred save preserves it and remains dirty', async () => {
  const drive = setupDrive(fixture())
  await render(App)
  await editRate('USD', '33')
  const saveButton = button('儲存變更')
  await act(async () => { saveButton.click(); saveButton.click() })
  assert.equal(drive.writes, 1)
  assert.equal(drive.uploadedEtag, '"v1"')
  assert.equal(drive.uploaded.fxRates.USD, 33)
  await editRate('SGD', '25')
  await drive.finish()
  assert.equal(document.querySelector('[aria-label="SGD 匯率"]').value, '25')
  assert.ok(button('儲存變更'))
  await click(button('儲存變更'))
  assert.equal(drive.uploaded.fxRates.SGD, 25)
  assert.equal(drive.uploadedEtag, '"v2"')
  await drive.finish()
  assert.ok(document.querySelector('.synced'))
})

test('Drive conflict leaves unsaved rate and backup action available', async () => {
  const drive = setupDrive(fixture())
  await render(App)
  await editRate('USD', '34')
  await click(button('儲存變更'))
  await drive.finish(412)
  assert.equal(document.querySelector('[aria-label="USD 匯率"]').value, '34')
  assert.ok(button('儲存變更'))
  assert.match(document.querySelector('[role="alert"]').textContent, /其他裝置/)
  assert.ok(button('下載本機資料備份'))
})

test('daily snapshot and manual saves are serialized; edits during snapshot remain dirty', async () => {
  const data = fixture()
  data.accounts = [{ id: 'a', name: 'Bank', kind: 'bank', country: 'US', category: '現金', positions: [
    { id: 'p', type: 'cash', currency: 'USD', symbol: '', quantity: 10, price: 1 },
  ] }]
  const drive = setupDrive(data)
  await render(App)
  assert.equal(drive.writes, 1)
  await editRate('USD', '35')
  assert.equal(button('儲存中…').disabled, true)
  await click(button('儲存中…'))
  assert.equal(drive.writes, 1)
  await drive.finish()
  assert.equal(document.querySelector('[aria-label="USD 匯率"]').value, '35')
  assert.ok(button('儲存變更'))
})

test('review Escape and cancel work before save but cannot dismiss an in-flight save', async () => {
  let cancelled = 0, confirmed = 0
  const props = { changes: [], busy: false, canRevert: () => false, onRevert: () => {}, onConfirm: () => confirmed++, onCancel: () => cancelled++ }
  await render(SaveReview, props)
  await act(async () => document.querySelector('dialog').dispatchEvent(new Event('cancel', { cancelable: true })))
  assert.equal(cancelled, 1)
  await click(button('繼續編輯'))
  assert.equal(cancelled, 2)
  await click(button('確認儲存'))
  assert.equal(confirmed, 1)
  await render(SaveReview, { ...props, busy: true })
  const escape = new Event('cancel', { cancelable: true })
  await act(async () => document.querySelector('dialog').dispatchEvent(escape))
  assert.equal(escape.defaultPrevented, true)
  await click(button('繼續編輯'))
  await click(button('儲存中…'))
  assert.equal(cancelled, 2)
  assert.equal(confirmed, 1)
})

test('import preview shows deletions, blocks errors/stale preview, and only applies after confirmation', async () => {
  const data = fixture()
  data.accounts = [{ id: 'a', name: 'Broker', kind: 'investment', country: 'US', category: '股票', positions: [
    { id: 'p', type: 'holding', currency: 'USD', symbol: 'AAPL', quantity: 10, price: 100 },
  ] }]
  let changed, closed = 0
  const props = { data, onChange: (next) => { changed = next }, view: { page: 'list', importing: true }, setView: () => closed++, onBack: () => {}, onRefreshPrices: async () => {}, priceError: '' }
  await render(Accounts, props)
  await setInput(document.querySelector('textarea'), 'Broker\t現金\t\tUSDC\t20\t1\t\t32\nBroker\t現金\t\tNOPE\t10')
  await click(button('預覽匯入'))
  assert.equal(changed, undefined)
  assert.match(document.querySelector('[role="alert"]').textContent, /第 2 列/)
  assert.equal(button('確認匯入並取代上述資料').disabled, true)
  await setInput(document.querySelector('textarea'), 'Broker\t現金\t\tUSDC\t20\t1\t\t32')
  await click(button('預覽匯入'))
  assert.match(document.body.textContent, /刪除以下 1 筆原持倉/)
  assert.match(document.body.textContent, /AAPL · USD · 數量 10/)
  assert.equal(changed, undefined)
  await render(Accounts, { ...props, data: { ...data } })
  assert.equal(button('確認匯入並取代上述資料').disabled, true)
  await click(button('預覽匯入'))
  await click(button('確認匯入並取代上述資料'))
  assert.equal(changed.accounts[0].positions[0].currency, 'USDC')
  assert.equal(closed, 1)
})

test('cancelling import preview never changes the source data', async () => {
  let changes = 0, closed = 0
  await render(Accounts, { data: fixture(), onChange: () => changes++, view: { page: 'list', importing: true }, setView: () => closed++, onBack: () => {}, onRefreshPrices: async () => {}, priceError: '' })
  await setInput(document.querySelector('textarea'), 'Bank\t現金\t\tUSD\t20')
  await click(button('預覽匯入'))
  await click(button('取消'))
  assert.equal(changes, 0)
  assert.equal(closed, 1)
})

// All liability examples below are synthetic, not transcribed from financial documents.
const syntheticDebt = { id: 'synthetic-debt', name: '合成貸款', kind: 'personal', currency: 'TWD', balance: 800 }
const field = (label) => [...document.querySelectorAll('label.field')].find((l) => l.querySelector('span')?.textContent === label)?.querySelector('input,select,textarea') ?? [...document.querySelectorAll('input[aria-label]')].find(i => i.getAttribute('aria-label') === label)

test('liability create/edit/cancel/delete are local and payment details do not replace balance', async () => {
  let current
  function Harness() {
    const [data, setData] = useState(fixture)
    useEffect(() => { current = data }, [data])
    return createElement(Liabilities, { data, onChange: setData })
  }
  await render(Harness)
  await click(button('＋ 新增負債'))
  await selectValue('計算基準', 'manual')
  await setInput(field('負債名稱'), '不應保留的合成草稿')
  await click(button('取消'))
  assert.equal(current.liabilities.length, 0)
  await click(button('＋ 新增負債'))
  await selectValue('計算基準', 'manual')
  await setInput(field('負債名稱'), '合成貸款')
  await setInput(field('目前未償餘額'), '800')
  await setInput(field('年利率（%）'), '0')
  await setInput(field('剩餘期數（月）'), '24')
  await setInput(field('下次到期日（選填）'), '2028-02-29')
  await setInput(field('備註（選填）'), '純合成備註')
  await click(button('套用負債'))
  assert.equal(current.liabilities.length, 1)
  assert.equal(current.liabilities[0].balance, 800)
  assert.equal(current.liabilities[0].remainingInstallments, 24)
  assert.equal(current.liabilities[0].repaymentMethod, 'annuity')
  assert.equal(current.liabilities[0].annualRate, 0)
  const id = current.liabilities[0].id
  await click(document.querySelector('[aria-label="編輯負債 合成貸款"]'))
  await setInput(field('目前未償餘額'), '1')
  await click(button('取消'))
  assert.equal(current.liabilities[0].balance, 800)
  await click(document.querySelector('[aria-label="編輯負債 合成貸款"]'))
  await setInput(field('目前未償餘額'), '700')
  await setInput(field('幣別'), 'USD')
  await click(button('套用負債'))
  assert.equal(current.liabilities[0].id, id)
  assert.equal(current.liabilities[0].balance, 700)
  assert.equal(current.liabilities[0].currency, 'USD')
  assert.equal(current.liabilities[0].paymentAmount, undefined)
  globalThis.confirm = () => false
  await click(document.querySelector('[aria-label="刪除負債 合成貸款"]'))
  assert.equal(current.liabilities.length, 1)
  globalThis.confirm = () => true
  await click(document.querySelector('[aria-label="刪除負債 合成貸款"]'))
  assert.deepEqual(current.liabilities, [])
})

test('invalid liability form stays open without applying partial data', async () => {
  let changes = 0
  await render(Liabilities, { data: fixture(), onChange: () => changes++ })
  await click(button('＋ 新增負債'))
  await selectValue('計算基準', 'manual')
  await setInput(field('負債名稱'), '合成貸款')
  await setInput(field('年利率（%）'), '2')
  await setInput(field('剩餘期數（月）'), '12')
  await setInput(field('目前未償餘額'), '-10')
  await click(button('套用負債'))
  assert.match(document.querySelector('[role="alert"]').textContent, /不得小於/)
  assert.equal(changes, 0)
  await setInput(field('目前未償餘額'), '0')
  await setInput(field('剩餘期數（月）'), '3.5')
  await click(button('套用負債'))
  assert.match(document.querySelector('[role="alert"]').textContent, /整數/)
  assert.equal(changes, 0)
})

test('overview displays negative net worth for debt-only data and hides totals with missing rates', async () => {
  const data = { ...fixture(), liabilities: [syntheticDebt] }
  const props = { data, onGoRates: () => {}, onGoLiabilities: () => {}, onNewAccount: () => {}, onImport: () => {}, onOpenAccount: () => {} }
  await render(Overview, props)
  assert.match(document.querySelector('[aria-label="總負債"]').textContent, /800/)
  assert.match(document.querySelector('[aria-label="淨資產"]').textContent, /-800/)
  assert.match(document.body.textContent, /總資產為 0/)
  await render(Overview, { ...props, data: { ...data, liabilities: [{ ...syntheticDebt, currency: 'EUR' }] } })
  assert.match(document.querySelector('[aria-label="淨資產"]').textContent, /尚無法換算/)
  assert.match(document.body.textContent, /EUR 沒有匯率/)
})

test('history distinguishes legacy unrecorded debt values and preserves asset chart modes', async () => {
  const data = { ...fixture(), liabilities: [syntheticDebt], history: { changes: [], snapshots: [
    { date: '2024-01-01', at: '2024-01-01T12:00:00Z', total: 500, accounts: [], categories: {} },
    { date: '2024-01-02', at: '2024-01-02T12:00:00Z', total: 500, accounts: [], categories: {}, liabilityTotal: 800, netWorth: -300 },
  ] } }
  await render(HistoryView, { data, dirty: false, busy: false, onSave: () => {}, onChange: () => {}, onOpenAccount: () => {} })
  assert.ok(document.querySelector('section[aria-label="每日紀錄"]'))
  assert.equal(document.querySelector('details.daily'), null)
  assert.equal((document.querySelector('table').textContent.match(/未記錄/g) ?? []).length, 2)
  assert.match(document.querySelector('table').textContent, /-300/)
  assert.ok(button('總資產'))
  assert.ok(button('依帳戶'))
  assert.ok(button('依類別'))
})

test('liability edit during daily save survives, stays dirty, and next save reviews the correct difference', async () => {
  window.history.replaceState(null, '', '/liabilities')
  const data = { ...fixture(), liabilities: [syntheticDebt] }
  const drive = setupDrive(data)
  await render(App)
  assert.equal(drive.writes, 1)
  assert.equal(drive.uploaded.liabilities[0].balance, 800)
  await click(document.querySelector('[aria-label="編輯負債 合成貸款"]'))
  await setInput(field('目前未償餘額'), '700')
  await click(button('套用負債'))
  await drive.finish()
  assert.match(document.querySelector('.liability-balance').textContent, /700/)
  assert.ok(button('儲存變更'))
  await click(button('儲存變更'))
  assert.match(document.querySelector('dialog').textContent, /TWD 800 → TWD 700/)
  assert.equal(drive.writes, 1)
  await click(button('確認儲存'))
  assert.equal(drive.writes, 2)
  assert.equal(drive.uploaded.liabilities[0].balance, 700)
  assert.equal(drive.uploaded.history.liabilityChanges.at(-1).before.balance, 800)
  assert.equal(drive.uploaded.history.liabilityChanges.at(-1).after.balance, 700)
  await drive.finish()
  assert.ok(document.querySelector('.synced'))
})

test('liability save review cancellation keeps edits and revert restores a deleted debt', async () => {
  window.history.replaceState(null, '', '/liabilities')
  const data = { ...fixture(), liabilities: [syntheticDebt] }
  const drive = setupDrive(data)
  await render(App)
  await drive.finish()
  globalThis.confirm = () => true
  await click(document.querySelector('[aria-label="刪除負債 合成貸款"]'))
  await click(button('儲存變更'))
  assert.match(document.querySelector('dialog').textContent, /移除負債/)
  await click(button('繼續編輯'))
  assert.equal(document.querySelector('.liability-balance'), null)
  assert.ok(button('儲存變更'))
  await click(button('儲存變更'))
  await click(button('復原負債'))
  assert.equal(document.querySelector('dialog'), null)
  assert.match(document.querySelector('.liability-balance').textContent, /800/)
  assert.equal(drive.writes, 1)
})

const selectValue = async (label, value) => act(async () => {
  const select = field(label)
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
})
test('loan form defaults to annuity, switches to declining payments, and bounds schedule pages', async () => {
  let changed
  await render(Liabilities, { data: fixture(), onChange: next => { changed = next } })
  await click(button('＋ 新增負債'))
  await selectValue('計算基準', 'manual')
  assert.equal(field('還款方式').value, 'annuity')
  await setInput(field('負債名稱'), '合成試算')
  await setInput(field('目前未償餘額'), '1200')
  await setInput(field('年利率（%）'), '12')
  await setInput(field('剩餘期數（月）'), '24')
  assert.match(document.body.textContent, /預估每月應付/)
  assert.equal(document.querySelectorAll('.loan-schedule tbody tr').length, 12)
  await click(button('後 12 期'))
  assert.equal(document.querySelector('.loan-schedule tbody td').textContent, '13')
  await selectValue('還款方式', 'equalPrincipal')
  assert.doesNotMatch(document.body.textContent, /預估每月應付/)
  assert.match(document.body.textContent, /預估首期應付/)
  await setInput(field('剩餘期數（月）'), '1')
  assert.equal(document.querySelectorAll('.loan-schedule tbody tr').length, 1)
  assert.equal(document.querySelector('.loan-schedule tbody td').textContent, '1')
  await click(button('套用負債'))
  assert.equal(changed.liabilities[0].balance, 1200)
  assert.equal(changed.liabilities[0].repaymentMethod, 'equalPrincipal')
  assert.equal(changed.liabilities[0].paymentAmount, undefined)
})
test('credit and irregular debt can save balance only even after invalid projection input', async () => {
  let changed
  await render(Liabilities, { data: fixture(), onChange: next => { changed = next } })
  await click(button('＋ 新增負債'))
  await selectValue('計算基準', 'manual')
  await setInput(field('負債名稱'), '合成信用卡')
  await setInput(field('目前未償餘額'), '200')
  await setInput(field('年利率（%）'), 'invalid')
  await setInput(field('剩餘期數（月）'), '-1')
  await selectValue('負債類型', 'credit')
  assert.equal(field('還款方式').value, 'none')
  assert.equal(document.querySelector('[aria-label="貸款試算"]'), null)
  await click(button('套用負債'))
  assert.equal(changed.liabilities[0].balance, 200)
  assert.equal(changed.liabilities[0].annualRate, undefined)
  assert.equal(changed.liabilities[0].remainingInstallments, undefined)
})
test('editing legacy manual debt retains values without inferring projection or remaining periods', async () => {
  const legacy = { ...syntheticDebt, annualRate: 2, paymentAmount: 20, totalInstallments: 24, paidInstallments: 3 }
  let changed
  await render(Liabilities, { data: { ...fixture(), liabilities: [legacy] }, onChange: next => { changed = next } })
  await click(document.querySelector('[aria-label="編輯負債 合成貸款"]'))
  assert.equal(field('還款方式').value, 'none')
  assert.match(document.body.textContent, /既有手填資料/)
  await setInput(field('目前未償餘額'), '700')
  await click(button('套用負債'))
  assert.deepEqual(changed.liabilities[0], { ...legacy, balance: 700, repaymentMethod: 'none' })
})

test('new scheduled loan uses original amount and first due date only; name edits preserve baseline', async () => {
  let current
  function Harness() {
    const [data, setData] = useState(fixture)
    useEffect(() => { current = data }, [data])
    return createElement(Liabilities, { data, onChange: setData })
  }
  await render(Harness)
  await click(button('＋ 新增負債'))
  assert.equal(field('計算基準').value, 'original')
  assert.equal(field('剩餘期數（月）'), undefined)
  assert.equal(field('下次到期日（選填）'), undefined)
  await setInput(field('負債名稱'), '合成按期貸款')
  await setInput(field('原始貸款總額'), '1200')
  await setInput(field('年利率（%）'), '0')
  await setInput(field('總期數（月）'), '12')
  await setInput(field('第一期還款日'), '2024-02-29')
  await setInput(field('每月還款日（選填）'), '31')
  await setInput(field('貸款日曆時區'), 'Asia/Taipei')
  await click(button('套用負債'))
  const original = structuredClone(current.liabilities[0])
  assert.equal(original.balance, 1200)
  assert.equal(original.remainingInstallments, 12)
  assert.deepEqual(original.schedule, { source: 'original', baseDate: '2024-02-28', firstDueDate: '2024-02-29', monthlyDay: 31, timeZone: 'Asia/Taipei' })
  assert.equal(original.nextDueDate, undefined)
  assert.match(document.body.textContent, /預估已清償/)
  assert.match(document.querySelector('.liability-balance').textContent, /TWD 0/)
  await click(document.querySelector('[aria-label="編輯負債 合成按期貸款"]'))
  assert.ok(field('原始貸款總額').closest('fieldset').disabled)
  await setInput(field('負債名稱'), '改名合成貸款')
  await click(button('套用負債'))
  assert.deepEqual(current.liabilities[0], { ...original, name: '改名合成貸款' })
  await click(button('校正餘額／重設基準'))
  await setInput(field('目前未償餘額'), '999')
  await click(button('取消'))
  assert.equal(current.liabilities[0].balance, 1200)
})

test('correction requires confirmation, rejects future baseline, keeps audit and can stop estimation', async () => {
  const initial = { ...syntheticDebt, balance: 1200, annualRate: 12, repaymentMethod: 'annuity', remainingInstallments: 12,
    schedule: { source: 'original', baseDate: '2024-01-30', firstDueDate: '2024-01-31', monthlyDay: 31, timeZone: 'Asia/Taipei' } }
  let current
  function Harness() {
    const [data, setData] = useState({ ...fixture(), liabilities: [initial] })
    useEffect(() => { current = data }, [data])
    return createElement(Liabilities, { data, onChange: setData })
  }
  await render(Harness)
  await click(button('校正餘額／重設基準'))
  await setInput(field('目前未償餘額'), '900')
  await setInput(field('年利率（%）'), '6')
  await setInput(field('剩餘期數（月）'), '10')
  await setInput(field('校正原因'), '合成利率調整')
  await click(button('套用負債'))
  assert.match(document.querySelector('[role="alert"]').textContent, /確認基準/)
  assert.deepEqual(current.liabilities[0], initial)
  await click(document.querySelector('input[type="checkbox"]'))
  await setInput(field('校正基準日'), '2099-01-01')
  await setInput(field('新基準後第一期還款日'), '2099-01-31')
  await click(button('套用負債'))
  assert.match(document.querySelector('[role="alert"]').textContent, /不得晚於/)
  await setInput(field('校正基準日'), '2024-02-29')
  await setInput(field('新基準後第一期還款日'), '2024-03-31')
  await click(button('套用負債'))
  const corrected = current.liabilities[0]
  assert.equal(corrected.balance, 900)
  assert.equal(corrected.annualRate, 6)
  assert.equal(corrected.schedule.source, 'correction')
  assert.equal(corrected.basisHistory[0].balance, 1200)
  assert.deepEqual(corrected.basisHistory[0].schedule, initial.schedule)
  assert.match(document.body.textContent, /基準變更紀錄/)
  await click(button('校正餘額／重設基準'))
  await selectValue('計算基準', 'manual')
  await setInput(field('目前未償餘額'), '50')
  await setInput(field('校正原因'), '改用合成銀行實際餘額')
  await click(document.querySelector('input[type="checkbox"]'))
  await click(button('套用負債'))
  assert.equal(current.liabilities[0].schedule, undefined)
  assert.equal(current.liabilities[0].balance, 50)
  assert.equal(current.liabilities[0].basisHistory.length, 2)
})

test('invalid monthly anchor blocks new loan with no partial application', async () => {
  let changes = 0
  await render(Liabilities, { data: fixture(), onChange: () => changes++ })
  await click(button('＋ 新增負債'))
  await setInput(field('負債名稱'), '合成錯誤日程')
  await setInput(field('原始貸款總額'), '1200')
  await setInput(field('年利率（%）'), '0')
  await setInput(field('總期數（月）'), '12')
  await setInput(field('第一期還款日'), '2024-03-30')
  await setInput(field('每月還款日（選填）'), '31')
  await click(button('套用負債'))
  assert.match(document.querySelector('[role="alert"]').textContent, /不一致/)
  assert.equal(changes, 0)
})

test('failed scheduled-debt save retains edits and original principal, with no payment writes', async () => {
  window.history.replaceState(null, '', '/liabilities')
  const data = { ...fixture(), version: 4, liabilities: [{ ...syntheticDebt, balance:1200, annualRate:0, repaymentMethod:'annuity', remainingInstallments:12,
    schedule:{source:'original',baseDate:'2024-01-30',firstDueDate:'2024-01-31',monthlyDay:31,timeZone:'Asia/Taipei'} }] }
  const drive = setupDrive(data)
  await render(App)
  assert.equal(drive.writes, 1) // existing daily snapshot, never a payment event
  assert.equal(drive.uploaded.liabilities[0].balance, 1200)
  assert.equal(drive.uploaded.history.snapshots.at(-1).liabilityEstimated, true)
  await click(document.querySelector('[aria-label="編輯負債 合成貸款"]'))
  await setInput(field('負債名稱'), '合成保留草稿')
  await click(button('套用負債'))
  await drive.finish(412)
  assert.match(document.body.textContent, /合成保留草稿/)
  assert.match(document.querySelector('.liability-balance').textContent, /TWD 0/)
  assert.equal(drive.writes, 1)
  assert.equal(drive.uploaded.liabilities[0].balance, 1200)
  assert.ok(button('儲存變更'))
})

const chooseHistoryInstrument = async (accountId, symbol) => {
 const accounts = field('補登帳戶')
 await selectValue('補登帳戶', accountId ?? accounts.options[1].value)
 await click(button('下一步：選標的'))
 const instruments = field('補登標的')
 const option = symbol ? [...instruments.options].find(o => o.textContent.includes(symbol)) : instruments.options[1]
 await selectValue('補登標的', option.value)
 await click(button('下一步：填數量'))
}
const historicalFixture = () => ({ ...fixture(), accounts: [{ id: 'history-account', name: '合成歷史帳戶', kind: 'investment', country: 'TW', category: '股票', positions: [
  { id: 'history-cash', type: 'cash', currency: 'TWD', symbol: '', quantity: 900, price: 1 },
] }] })
test('historical quantity add/edit/cancel/restore changes only chosen date; charts and list use the same value', async () => {
  let current
  function Harness() {
    const [data,setData] = useState(historicalFixture)
    useEffect(()=>{current=data},[data])
    return createElement(HistoryView,{data,dirty:true,busy:false,onChange:setData,onSave:()=>{},onOpenAccount:()=>{}})
  }
  await render(Harness)
  await click(button('＋ 補登歷史數量'))
 await chooseHistoryInstrument()
  await setInput(field('歷史日期'),'2025-10-04')
  const label='合成歷史帳戶 · TWD · TWD 當日數量'
  assert.equal(field(label).value,'')
  await setInput(field(label),'100')
  await click(button('取消歷史編輯'))
  assert.equal(current.history.quantityDays,undefined)
  await click(button('＋ 補登歷史數量'))
 await chooseHistoryInstrument()
  await setInput(field('歷史日期'),'2025-10-04')
  await setInput(field(label),'100')
  await click(button('取得歷史估值'))
  assert.match(document.querySelector('[role="status"]').textContent,/100/)
  await click(button('套用歷史數量'))
  assert.equal(current.accounts[0].positions[0].quantity,900)
  assert.equal(current.history.quantityDays[0].entries[0].quantity,100)
  const row=[...document.querySelectorAll('section.daily tbody tr')].find(r=>r.textContent.includes('2025/10/04'))
  assert.match(row.textContent,/100/)
  assert.match(row.textContent,/未記錄/)
  await click(button('編輯數量 2025-10-04'))
 await chooseHistoryInstrument()
  assert.equal(field('歷史日期').disabled,true)
  await setInput(field(label),'0')
  await click(button('取得歷史估值'))
  await click(button('套用歷史數量'))
  assert.equal(current.history.quantityDays[0].entries[0].quantity,0)
  await click(button('復原上次歷史修改'))
  assert.equal(current.history.quantityDays[0].entries[0].quantity,100)
  globalThis.confirm=()=>false
  await click(button('移除 2025-10-04'))
  assert.equal(current.history.quantityDays.length,1)
  globalThis.confirm=()=>true
  await click(button('移除 2025-10-04'))
  assert.equal(current.history.quantityDays.length,0)
  assert.ok(![...document.querySelectorAll('section.daily tbody tr')].some(r=>r.textContent.includes('2025/10/04')))
  await click(button('復原上次歷史修改'))
  assert.equal(current.history.quantityDays.length,1)
})
test('historical editor validates quantities, duplicates and future dates; late quotes cannot apply cancelled edits', async () => {
  let current
  const base=historicalFixture()
  base.accounts[0].positions=[{id:'history-stock',type:'holding',symbol:'TEST',currency:'USD',quantity:1,price:999}]
  function Harness(){const [data,setData]=useState(base);useEffect(()=>{current=data},[data]);return createElement(HistoryView,{data,dirty:true,busy:false,onChange:setData,onSave:()=>{},onOpenAccount:()=>{}})}
  await render(Harness)
  await click(button('＋ 補登歷史數量'))
 await chooseHistoryInstrument()
  await setInput(field('歷史日期'),'2999-01-01')
  await click(button('取得歷史估值'))
  assert.match(document.querySelector('[role="alert"]').textContent,/未來/)
  await setInput(field('歷史日期'),'2025-10-04')
  await setInput(field('合成歷史帳戶 · TEST · USD 當日數量'),'-1')
  await click(button('取得歷史估值'))
  assert.match(document.querySelector('[role="alert"]').textContent,/非負/)
  await setInput(field('合成歷史帳戶 · TEST · USD 當日數量'),'2')
  const pending=[]
  globalThis.fetch=()=>new Promise(resolve=>pending.push(resolve))
  await click(button('取得歷史估值'))
  assert.ok(button('取得歷史行情中…'))
  await click(button('取消歷史編輯'))
  await act(async()=>{pending.forEach(resolve=>resolve(Response.json({symbol:'TEST',currency:'USD',asTraded:true,points:[]})))})
  // A cancelled request may finish its market-only FX request; it must not write.
  await act(async()=>{pending.forEach(resolve=>resolve(Response.json({symbol:'USDTWD=X',currency:'TWD',asTraded:true,points:[]})))})
  assert.equal(document.querySelector('[aria-label="編輯歷史數量"]'),null)
  assert.equal(current.history.quantityDays,undefined)
})
test('missing historical prices preserve quantity and show incomplete total instead of zero',async()=>{
 const data=historicalFixture();data.accounts[0].positions=[{id:'history-stock',type:'holding',symbol:'TEST',currency:'USD',quantity:1,price:999}]
 let changed
 await render(HistoryView,{data,dirty:true,busy:false,onChange:next=>{changed=next},onSave:()=>{},onOpenAccount:()=>{}})
 globalThis.fetch=async()=>new Response('',{status:404})
 await click(button('＋ 補登歷史數量'))
 await chooseHistoryInstrument()
 await setInput(field('歷史日期'),'2025-10-04')
 await setInput(field('合成歷史帳戶 · TEST · USD 當日數量'),'2')
 await click(button('取得歷史估值'))
 assert.match(document.querySelector('[role="status"]').textContent,/資料不完整/)
 assert.match(document.body.textContent,/缺少歷史匯率/)
 await click(button('套用歷史數量'))
 assert.equal(changed.history.quantityDays[0].entries[0].quantity,2)
 assert.equal(changed.history.quantityDays[0].entries[0].price,undefined)
 assert.equal(changed.accounts[0].positions[0].quantity,1)
})
test('quantity edits during Drive save remain dirty while committed history metadata survives',async()=>{
 window.history.replaceState(null,'','/history')
 const data=historicalFixture(),drive=setupDrive(data)
 await render(App)
 assert.equal(drive.writes,1)
 await click(button('＋ 補登歷史數量'))
 await chooseHistoryInstrument()
 await setInput(field('歷史日期'),'2025-10-04')
 await setInput(field('合成歷史帳戶 · TWD · TWD 當日數量'),'100')
 await click(button('取得歷史估值'))
 await click(button('套用歷史數量'))
 await drive.finish()
 assert.ok(button('儲存變更'))
 assert.match(document.querySelector('[aria-label="歷史持倉數量"]').textContent,/2025-10-04/)
 await click(button('儲存變更'))
 assert.equal(drive.writes,2)
 assert.equal(drive.uploaded.version,3)
 assert.equal(drive.uploaded.history.quantityDays[0].entries[0].quantity,100)
 assert.equal(drive.uploaded.accounts[0].positions[0].quantity,900)
 await drive.finish()
 assert.ok(document.querySelector('.synced'))
})

test('same-day manual quantities survive login without an automatic Drive write',async()=>{
 window.history.replaceState(null,'','/history')
 const data=historicalFixture(),now=new Date().toISOString()
 const {localDate}=await server.ssrLoadModule('/src/history.ts')
 data.version=3
 data.history.quantityDays=[{date:localDate(now),updatedAt:now,entries:[{accountId:'history-account',account:'合成歷史帳戶',category:'股票',country:'TW',type:'cash',symbol:'',currency:'TWD',quantity:0}]}]
 const drive=setupDrive(data)
 await render(App)
 assert.equal(drive.writes,0)
 assert.match(document.querySelector('section.daily tbody tr').textContent,/NT\$ 0/)
 assert.match(document.querySelector('section.daily tbody tr').textContent,/手動/)
})
test('trend chart leaves an actual gap for unknown history and clears out-of-range hover after deletion',async()=>{
 const oldObserver=globalThis.ResizeObserver
 globalThis.ResizeObserver=class{constructor(callback){this.callback=callback}observe(){this.callback([{contentRect:{width:400}}])}disconnect(){}}
 const {TrendChart}=await server.ssrLoadModule('/src/views/TrendChart.tsx')
 try{
 await render(TrendChart,{dates:['2025-10-01','2025-10-02','2025-10-03'],series:[{key:'test',label:'合成資產',color:'blue',values:[100,null,300]}],area:true})
 const path=document.querySelector('path.line').getAttribute('d')
 assert.equal((path.match(/M/g)??[]).length,2)
 assert.equal(path.includes('L'),false)
 assert.equal(document.querySelector('path.area'),null)
 assert.equal(document.querySelectorAll('circle.dot').length,2)
 await act(async()=>document.querySelector('svg > rect').dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:400})))
 await render(TrendChart,{dates:['2025-10-01'],series:[{key:'test',label:'合成資產',color:'blue',values:[null]}],area:true})
 assert.equal(document.querySelector('.trend-tip'),null)
 assert.equal(document.querySelectorAll('circle.dot').length,0)
 assert.doesNotMatch(document.querySelector('svg').outerHTML,/NaN|Infinity/)
 }finally{globalThis.ResizeObserver=oldObserver}
})
test('unquoted holdings keep quantity without a historical manual price field',async()=>{
 const data=historicalFixture();data.accounts[0].positions=[{id:'fund',type:'holding',symbol:'基金與退休金',currency:'TWD',quantity:3,price:10,priceManual:true}]
 let changed,requests=0
 await render(HistoryView,{data,dirty:true,busy:false,onChange:next=>{changed=next},onSave:()=>{},onOpenAccount:()=>{}})
 globalThis.fetch=async()=>{requests++;return new Response('',{status:404})}
 await click(button('＋ 補登歷史數量'))
 await chooseHistoryInstrument()
 await setInput(field('歷史日期'),'2025-10-04')
 await setInput(field('合成歷史帳戶 · 基金與退休金 · TWD 當日數量'),'2')
 assert.equal(field('合成歷史帳戶 · 基金與退休金 · TWD 當日單價'),undefined)
 await click(button('取得歷史估值'))
 assert.equal(requests,0)
 assert.match(document.querySelector('[role="status"]').textContent,/資料不完整/)
 await click(button('套用歷史數量'))
 assert.equal(changed.history.quantityDays[0].entries[0].price,undefined)
  assert.equal(changed.accounts[0].positions[0].price,10)
})

test('viewing and refreshing historical valuations queries market data without editing stored quantities or prices',async()=>{
 const data=historicalFixture();data.accounts[0].positions=[{id:'history-stock',type:'holding',symbol:'TEST',currency:'TWD',quantity:1,price:999,priceManual:true}]
 data.version=3
 data.history.quantityDays=[{date:'2025-10-04',updatedAt:'2025-10-06T12:00:00Z',entries:[{accountId:'history-account',account:'合成歷史帳戶',category:'股票',country:'TW',type:'holding',symbol:'TEST',currency:'TWD',quantity:2,price:{source:'manual',symbol:'TEST',date:'2025-10-04',value:999}}]}]
 let price=10,requests=0,changes=0,missing=false
 globalThis.fetch=async()=>{requests++;return missing?new Response('',{status:404}):Response.json({symbol:'TEST',currency:'TWD',asTraded:true,splits:[],points:[{date:'2025-10-03',close:price}]})}
 await render(HistoryView,{data,dirty:false,busy:false,onChange:()=>changes++,onSave:()=>{},onOpenAccount:()=>{}})
 const row=()=>[...document.querySelectorAll('section.daily tbody tr')].find(r=>r.textContent.includes('2025/10/04'))
 assert.match(row().textContent,/NT\$ 20/)
 assert.match(document.querySelector('[aria-label="歷史持倉數量"]').textContent,/2025-10-03/)
 price=20
 await click(button('重新查詢歷史行情'))
 assert.match(row().textContent,/NT\$ 40/)
 missing=true
 await click(button('重新查詢歷史行情'))
 assert.match(row().textContent,/資料不完整/)
 assert.equal(requests,3);assert.equal(changes,0)
 assert.equal(data.history.quantityDays[0].entries[0].price.value,999)
 assert.equal(data.accounts[0].positions[0].price,999)
 await click(button('編輯數量 2025-10-04'))
 await chooseHistoryInstrument()
 assert.equal(field('合成歷史帳戶 · TEST · TWD 當日單價'),undefined)
 await click(button('取消歷史編輯'))
})

test('history wizard selects account before instrument, clears cross-account selection and cancels cleanly', async () => {
 const data=historicalFixture()
 data.accounts[0].positions=[{id:'a-stock',type:'holding',symbol:'TEST',currency:'TWD',quantity:1,price:10}]
 data.accounts.push({...data.accounts[0],id:'second-account',name:'第二合成帳戶',positions:[{...data.accounts[0].positions[0],id:'b-stock'}]})
 let changes=0
 await render(HistoryView,{data,dirty:true,busy:false,onChange:()=>changes++,onSave:()=>{},onOpenAccount:()=>{}})
 await click(button('＋ 補登歷史數量'))
 assert.equal(field('補登帳戶').value,'')
 assert.equal(field('補登標的'),undefined);assert.equal(field('歷史日期'),undefined)
 await chooseHistoryInstrument('history-account','TEST')
 await setInput(field('合成歷史帳戶 · TEST · TWD 當日數量'),'77')
 await click(button('上一步'));await click(button('上一步'))
 await selectValue('補登帳戶','second-account');await click(button('下一步：選標的'))
 assert.equal(field('補登標的').value,'')
 assert.ok([...field('補登標的').options].filter(o=>o.value && o.value!=='__new__').every(o=>JSON.parse(o.value)[0]==='second-account'))
 await selectValue('補登標的',field('補登標的').options[1].value);await click(button('下一步：填數量'))
 assert.equal(field('第二合成帳戶 · TEST · TWD 當日數量').value,'')
 await click(button('取消歷史編輯'));assert.equal(changes,0)
 await click(button('＋ 補登歷史數量'));assert.equal(field('補登帳戶').value,'')
})

test('single-instrument update preserves every other entry and date, including the same symbol in another account', async () => {
 const data=historicalFixture(),date='2025-10-04'
 data.accounts[0].positions=[{id:'stock',type:'holding',symbol:'TEST',currency:'TWD',quantity:100,price:10}]
 data.accounts.push({...data.accounts[0],id:'b',name:'第二合成帳戶'})
 const entry=(accountId,account,quantity)=>({accountId,account,category:'股票',country:'TW',type:'holding',symbol:'TEST',currency:'TWD',quantity})
 const day={date,updatedAt:date+'T12:00:00Z',entries:[entry('history-account','合成歷史帳戶',5),entry('b','第二合成帳戶',8)]}
 data.history.quantityDays=[{...day,date:'2025-10-03'},day]
 let changed
 globalThis.fetch=async()=>Response.json({symbol:'TEST',currency:'TWD',asTraded:true,splits:[],points:[{date:'2025-10-03',close:10}]})
 await render(HistoryView,{data,dirty:true,busy:false,onChange:next=>{changed=next},onSave:()=>{},onOpenAccount:()=>{}})
 assert.ok([...document.querySelectorAll('details.quantity-day')].every(d=>!d.open))
 await click(button('＋ 補登歷史數量'));await chooseHistoryInstrument('history-account','TEST')
 await setInput(field('歷史日期'),date);assert.equal(field('合成歷史帳戶 · TEST · TWD 當日數量').value,'5')
 await setInput(field('合成歷史帳戶 · TEST · TWD 當日數量'),'6')
 await click(button('取得歷史估值'));assert.match(document.querySelector('[role="status"]').textContent,/140/)
 await click(button('返回修改'));assert.equal(field('合成歷史帳戶 · TEST · TWD 當日數量').value,'6')
 await click(button('取得歷史估值'));await click(button('套用歷史數量'))
 const result=changed.history.quantityDays.find(d=>d.date===date)
 assert.equal(result.entries.find(e=>e.accountId==='history-account').quantity,6)
 assert.equal(result.entries.find(e=>e.accountId==='b').quantity,8)
 assert.deepEqual(changed.history.quantityDays[0],data.history.quantityDays[0])
 assert.deepEqual(changed.accounts,data.accounts)
})

test('empty account accepts a removed instrument without manual pricing and row edit opens only that instrument', async () => {
 const initial=historicalFixture();initial.accounts[0].positions=[]
 let current
 function Harness(){const [data,setData]=useState(initial);useEffect(()=>{current=data},[data]);return createElement(HistoryView,{data,dirty:true,busy:false,onChange:setData,onSave:()=>{},onOpenAccount:()=>{}})}
 globalThis.fetch=async()=>new Response('',{status:404})
 await render(Harness);await click(button('＋ 補登歷史數量'))
 await selectValue('補登帳戶','history-account');await click(button('下一步：選標的'))
 assert.match(document.body.textContent,/目前沒有持倉/)
 await selectValue('補登標的','__new__');await setInput(field('歷史標的代號'),'已移除合成基金');await click(button('下一步：填數量'))
 await setInput(field('歷史日期'),'2025-10-04');await setInput(field('合成歷史帳戶 · 已移除合成基金 · TWD 當日數量'),'3')
 await click(button('取得歷史估值'));assert.match(document.querySelector('[role="status"]').textContent,/資料不完整/)
 assert.equal(document.querySelector('input[inputmode="decimal"]'),null)
 await click(button('套用歷史數量'))
 assert.equal(current.accounts[0].positions.length,0)
 const rowButton=document.querySelector('[aria-label="編輯 2025-10-04 合成歷史帳戶 · 已移除合成基金 · TWD"]')
 await click(rowButton)
 assert.equal(field('合成歷史帳戶 · 已移除合成基金 · TWD 當日數量').value,'3')
 assert.equal(document.querySelectorAll('input[inputmode="decimal"]').length,1)
 assert.equal(field('歷史日期').disabled,true)
})

test('wizard blocks stale day preview and retains unknown other quantities on a new date', async () => {
 const data=historicalFixture();data.accounts.push({...data.accounts[0],id:'b',name:'第二合成帳戶'})
 let applied=0
 const props={data,dirty:true,busy:false,onChange:()=>applied++,onSave:()=>{},onOpenAccount:()=>{}}
 await render(HistoryView,props);await click(button('＋ 補登歷史數量'));await chooseHistoryInstrument()
 await setInput(field('歷史日期'),'2025-10-04');await setInput(field('合成歷史帳戶 · TWD · TWD 當日數量'),'100')
 await click(button('取得歷史估值'));assert.match(document.querySelector('[role="status"]').textContent,/資料不完整/)
 const newer={...data,history:{...data.history,quantityDays:[{date:'2025-10-04',updatedAt:'2025-10-04T12:00:00Z',entries:[]}]}}
 await render(HistoryView,{...props,data:newer});await click(button('套用歷史數量'))
 assert.equal(applied,0);assert.match(document.querySelector('[role="alert"]').textContent,/已新增或變更/)
})

test('wizard offers recorded instruments from removed accounts and gives an empty-account-list explanation', async () => {
 const data=fixture()
 await render(HistoryView,{data,dirty:true,busy:false,onChange:()=>{},onSave:()=>{},onOpenAccount:()=>{}})
 await click(button('＋ 補登歷史數量'))
 assert.match(document.body.textContent,/目前沒有可補登的帳戶/)
 assert.equal(button('下一步：選標的').disabled,true)
 await click(button('取消歷史編輯'))
 data.history.quantityDays=[{date:'2025-10-04',updatedAt:'2025-10-04T12:00:00Z',entries:[{accountId:'removed',account:'已移除合成帳戶',category:'現金',country:'TW',type:'cash',symbol:'',currency:'TWD',quantity:5}]}]
 await render(HistoryView,{data:{...data},dirty:true,busy:false,onChange:()=>{},onSave:()=>{},onOpenAccount:()=>{}})
 await click(button('＋ 補登歷史數量'))
 assert.match(field('補登帳戶').textContent,/已移除合成帳戶（歷史帳戶）/)
 await chooseHistoryInstrument('removed')
 await setInput(field('歷史日期'),'2025-10-04')
 assert.equal(field('已移除合成帳戶 · TWD · TWD 當日數量').value,'5')
 await setInput(field('歷史日期'),'')
 await click(button('上一步'))
 await click(button('下一步：填數量'))
 assert.ok(field('歷史日期')) // an invalid draft date cannot trap the user on instrument selection
})

test('period wizard validates sale date, confirms overlap, preserves current positions, and supports undo',async()=>{
 const initial=historicalFixture();let current
 function Harness(){const [data,setData]=useState(initial);useEffect(()=>{current=data},[data]);return createElement(HistoryView,{data,dirty:true,busy:false,onChange:setData,onSave:()=>{},onOpenAccount:()=>{}})}
 await render(Harness)
 const enter=async(start,end,quantity)=>{
  await click(button('＋ 補登歷史數量'));await chooseHistoryInstrument();await selectValue('補登方式','period')
  await setInput(field('開始日期（含）'),start);await setInput(field('結束／賣出日期（不含，選填）'),end)
  await setInput(field('合成歷史帳戶 · TWD · TWD 當日數量'),quantity)
 }
 await enter('2026-10-01','2026-10-01','100');await click(button('取得歷史估值'))
 assert.match(document.querySelector('[role="alert"]').textContent,/晚於開始日/)
 await setInput(field('結束／賣出日期（不含，選填）'),'2026-10-02');await click(button('取得歷史估值'))
 assert.match(document.querySelector('[role="status"]').textContent,/結束不含/)
 await click(button('返回修改'));assert.equal(field('結束／賣出日期（不含，選填）').value,'2026-10-02')
 await click(button('取得歷史估值'));await click(button('套用歷史數量'))
 assert.equal(current.version,5);assert.equal(current.history.holdingPeriods.length,1);assert.deepEqual(current.accounts,initial.accounts)
 await enter('2026-10-01','','200');await click(button('取得歷史估值'));await click(button('套用歷史數量'))
 assert.equal(current.history.holdingPeriods.length,1);assert.match(document.querySelector('[role="alert"]').textContent,/確認重疊/)
 await click(document.querySelector('.quantity-editor input[type="checkbox"]'));await click(button('套用歷史數量'))
 assert.equal(current.history.holdingPeriods.length,2)
 await click(button('復原上次歷史修改'));assert.equal(current.history.holdingPeriods.length,1)
 globalThis.confirm=()=>true
 await click(button('移除期間 2026-10-01'));assert.equal(current.history.holdingPeriods.length,0)
 await click(button('復原上次歷史修改'));assert.equal(current.history.holdingPeriods.length,1)
})

test('period preview rejects edits arriving after preview and cancellation ignores delayed quote results',async()=>{
 const data=historicalFixture();let applied=0
 const props={data,dirty:true,busy:false,onChange:()=>applied++,onSave:()=>{},onOpenAccount:()=>{}}
 await render(HistoryView,props);await click(button('＋ 補登歷史數量'));await chooseHistoryInstrument();await selectValue('補登方式','period')
 await setInput(field('開始日期（含）'),'2026-10-01');await setInput(field('合成歷史帳戶 · TWD · TWD 當日數量'),'100')
 await click(button('取得歷史估值'))
 const newer={...data,accounts:[{...data.accounts[0],name:'已修改帳戶'}]}
 await render(HistoryView,{...props,data:newer});await click(button('套用歷史數量'))
 assert.equal(applied,0);assert.match(document.querySelector('[role="alert"]').textContent,/重新預覽期間/)
 await click(button('取消歷史編輯'))
 const stock={...data,accounts:[{...data.accounts[0],positions:[{id:'stock',type:'holding',symbol:'DELAY',currency:'TWD',quantity:1,price:10}]}]}
 let release
 globalThis.fetch=()=>new Promise(resolve=>{release=resolve})
 await render(HistoryView,{...props,data:stock});await click(button('＋ 補登歷史數量'));await chooseHistoryInstrument('history-account','DELAY');await selectValue('補登方式','period')
 await setInput(field('開始日期（含）'),'2026-10-01');await setInput(field('合成歷史帳戶 · DELAY · TWD 當日數量'),'10');await click(button('取得歷史估值'))
 await click(button('取消歷史編輯'))
 await act(async()=>release(Response.json({symbol:'DELAY',currency:'TWD',asTraded:true,splits:[],points:[]})))
 assert.equal(applied,0);assert.equal(document.querySelector('.quantity-editor'),null)
})
