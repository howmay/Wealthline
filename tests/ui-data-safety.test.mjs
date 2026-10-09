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
const field = (label) => [...document.querySelectorAll('label.field')].find((l) => l.querySelector('span')?.textContent === label)?.querySelector('input,select,textarea')

test('liability create/edit/cancel/delete are local and payment details do not replace balance', async () => {
  let current
  function Harness() {
    const [data, setData] = useState(fixture)
    useEffect(() => { current = data }, [data])
    return createElement(Liabilities, { data, onChange: setData })
  }
  await render(Harness)
  await click(button('＋ 新增負債'))
  await setInput(field('負債名稱'), '不應保留的合成草稿')
  await click(button('取消'))
  assert.equal(current.liabilities.length, 0)
  await click(button('＋ 新增負債'))
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
