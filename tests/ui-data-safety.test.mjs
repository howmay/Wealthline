import assert from 'node:assert/strict'
import { after, before, afterEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

let server, root, dom, App, Accounts, SaveReview, model, auth, createRoot
const originalFetch = globalThis.fetch
const token = { value: 'test-token', expiresAt: Date.now() + 3600_000 }
const profile = { sub: 'account-a', email: 'a@example.com', name: 'Alice' }
before(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://wealthline.test/rates' })
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'MouseEvent', 'PopStateEvent', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.scrollTo = () => {}
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  App = (await server.ssrLoadModule('/src/App.tsx')).default
  ;({ Accounts } = await server.ssrLoadModule('/src/views/Accounts.tsx'))
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
