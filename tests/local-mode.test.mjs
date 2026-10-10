import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

// Local mode: the app without Google sign-in, with the data file kept in localStorage.

let server, dom, root, App, model, auth, createRoot
const DATA_KEY = 'wealthline.local.data'
const ACTIVE_KEY = 'wealthline.local.active'
const originalFetch = globalThis.fetch
let requests = []
let downloads = []

before(async () => {
  // File and Blob stay Node's own, which have text() like a browser's (jsdom's do not).
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://wealthline.test/' })
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLAnchorElement', 'Event', 'MouseEvent', 'PopStateEvent', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  window.scrollTo = () => {}
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0)
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  App = (await server.ssrLoadModule('/src/App.tsx')).default
  model = await server.ssrLoadModule('/src/model.ts')
  auth = await server.ssrLoadModule('/src/google/auth.ts')
})
beforeEach(() => {
  requests = []
  downloads = []
  // Market lookups fail offline; nothing else may be requested.
  globalThis.fetch = async (url) => { requests.push(String(url)); throw new Error('offline') }
  globalThis.confirm = () => true
  URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:test' }
  URL.revokeObjectURL = () => {}
  HTMLAnchorElement.prototype.click = function () { downloads.at(-1).name = this.download }
})
afterEach(async () => {
  if (root) await act(() => root.unmount())
  root = null
  globalThis.fetch = originalFetch
  localStorage.clear()
  sessionStorage.clear()
  delete globalThis.confirm
  window.history.replaceState(null, '', '/')
})
after(async () => { await server.close(); dom.window.close() })

const render = async () => {
  if (root) await act(() => root.unmount())
  root = createRoot(document.getElementById('root'))
  await act(async () => { root.render(createElement(App)) })
}
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text)
const click = async (element) => { assert.ok(element); await act(async () => element.click()) }
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) })
const fixture = () => ({ ...model.emptyData(), fxRates: { USD: 32, SGD: 24 }, fxUpdatedAt: new Date().toISOString() })
const stored = () => JSON.parse(localStorage.getItem(DATA_KEY))
const editRate = async (currency, value) => {
  const input = document.querySelector(`[aria-label="${currency} 匯率"]`)
  assert.ok(input, `${currency} rate input`)
  await act(async () => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.blur()
  })
}
const uploadFile = async (text) => {
  const input = document.querySelector('input[type="file"]')
  assert.ok(input)
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], 'wealthline-data.json', { type: 'application/json' })] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  await settle()
}
const noGoogle = () => assert.deepEqual(requests.filter((u) => /google/.test(u)), [])

test('starting without sign-in opens the app and never contacts Google', async () => {
  await render()
  await click(button('不登入，直接在瀏覽器使用'))
  await settle()
  assert.equal(window.location.pathname, '/app')
  assert.ok(document.querySelector('.topbar'))
  assert.ok(document.querySelector('summary[aria-label="本機模式選單"]'))
  assert.equal(localStorage.getItem(ACTIVE_KEY), '1')
  noGoogle()
})

test('saves go to localStorage and a reload reopens local mode with them', async () => {
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/rates')
  await render()
  await settle()
  await editRate('USD', '33')
  await click(button('儲存變更'))
  await settle()
  assert.equal(stored().fxRates.USD, 33)
  assert.ok(document.querySelector('.synced'))

  await render()
  await settle()
  assert.equal(window.location.pathname, '/rates')
  assert.equal(document.querySelector('[aria-label="USD 匯率"]').value, '33')
  noGoogle()
})

test('the home page goes to the app while local mode is on', async () => {
  localStorage.setItem(ACTIVE_KEY, '1')
  await render()
  await settle()
  assert.equal(window.location.pathname, '/app')
})

test('a save stops when another tab changed the stored data, keeping the edit and offering a backup', async () => {
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/rates')
  await render()
  await settle()
  const other = { ...fixture(), fxRates: { USD: 40, SGD: 24 } }
  localStorage.setItem(DATA_KEY, JSON.stringify(other))
  await editRate('USD', '34')
  await click(button('儲存變更'))
  await settle()
  assert.match(document.querySelector('[role="alert"]').textContent, /其他分頁/)
  assert.equal(stored().fxRates.USD, 40)
  assert.equal(document.querySelector('[aria-label="USD 匯率"]').value, '34')
  assert.ok(button('儲存變更'))
  assert.ok(button('下載本機資料備份'))
})

test('download saves the last saved data file; it is disabled while edits are unsaved', async () => {
  const data = fixture()
  localStorage.setItem(DATA_KEY, JSON.stringify(data))
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/rates')
  await render()
  await settle()
  await click(button('下載資料檔'))
  assert.equal(downloads.length, 1)
  assert.match(downloads[0].name, /^wealthline-data-\d{4}-\d{2}-\d{2}\.json$/)
  assert.deepEqual(JSON.parse(await downloads[0].text()), model.parseWealthData(data))
  await editRate('USD', '35')
  assert.equal(button('下載資料檔').disabled, true)
})

test('uploading a data file from the home page restores it into local mode', async () => {
  const data = { ...fixture(), fxRates: { USD: 31, SGD: 23 } }
  await render()
  await uploadFile(JSON.stringify(data))
  assert.equal(window.location.pathname, '/app')
  assert.deepEqual(stored(), model.parseWealthData(data))
  assert.equal(localStorage.getItem(ACTIVE_KEY), '1')
  noGoogle()
})

test('an invalid upload shows why and changes nothing', async () => {
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
  const before = localStorage.getItem(DATA_KEY)
  await render()
  await uploadFile('not json')
  assert.match(document.querySelector('.signin-box .error').textContent, /不是有效的 JSON/)
  await uploadFile(JSON.stringify({ version: 1 }))
  assert.match(document.querySelector('.signin-box .error').textContent, /上傳的資料檔格式不正確/)
  assert.equal(localStorage.getItem(DATA_KEY), before)
  assert.equal(window.location.pathname, '/')
})

test('declining the replace prompt keeps the stored data', async () => {
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
  const before = localStorage.getItem(DATA_KEY)
  globalThis.confirm = () => false
  await render()
  await uploadFile(JSON.stringify({ ...fixture(), fxRates: { USD: 1 } }))
  assert.equal(localStorage.getItem(DATA_KEY), before)
  assert.equal(window.location.pathname, '/')
})

test('leaving local mode keeps the data for next time; deleting removes it', async () => {
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/app')
  await render()
  await settle()
  await click(button('離開本機模式'))
  assert.equal(window.location.pathname, '/')
  assert.equal(localStorage.getItem(ACTIVE_KEY), null)
  assert.ok(localStorage.getItem(DATA_KEY))
  await click(button('繼續使用此瀏覽器中的資料'))
  await settle()
  assert.equal(window.location.pathname, '/app')
  await click(button('刪除此瀏覽器中的資料'))
  assert.equal(localStorage.getItem(DATA_KEY), null)
  assert.equal(localStorage.getItem(ACTIVE_KEY), null)
  assert.ok(button('不登入，直接在瀏覽器使用'))
})

test('unreadable stored data returns to the home page with the reason', async () => {
  localStorage.setItem(DATA_KEY, '{"version":99,"accounts":[]}')
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/app')
  await render()
  await settle()
  assert.equal(document.querySelector('.topbar'), null)
  assert.match(document.querySelector('.signin-box .error').textContent, /此瀏覽器保存的資料格式不正確/)
  assert.equal(localStorage.getItem(ACTIVE_KEY), null)
})

test('public pages stay readable in local mode and link back to the app', async () => {
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/privacy')
  await render()
  assert.ok(document.querySelector('.legal article'))
  assert.match(document.querySelector('.legal article').textContent, /本機模式/)
  assert.equal(document.querySelector('.legal-back').getAttribute('href'), '/app')
  assert.deepEqual(requests, [])
})

test('a tab signed in to Google keeps its Drive session on reload when another tab turned local mode on', async () => {
  const profile = { sub: 'account-a', email: 'a@example.com', name: 'Alice' }
  auth.storeSession({ token: { value: 'test-token', expiresAt: Date.now() + 3600_000 }, profile })
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
  localStorage.setItem(ACTIVE_KEY, '1')
  globalThis.fetch = async (url) => {
    requests.push(String(url))
    if (String(url).includes('userinfo')) return Response.json(profile)
    if (String(url).includes('googleapis.com/drive')) return Response.json({ files: [] })
    throw new Error('offline')
  }
  window.history.replaceState(null, '', '/app')
  await render()
  await settle()
  assert.ok(document.querySelector('summary[aria-label="帳號選單"]'))
  assert.equal(document.querySelector('summary[aria-label="本機模式選單"]'), null)
  assert.ok(requests.some((u) => u.includes('googleapis.com/drive')))
})
