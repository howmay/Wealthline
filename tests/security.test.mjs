import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { createServer } from 'vite'

let server, auth, worker, drive, encryption
const profile = { sub: 'account-a', email: 'a@example.com', name: 'Alice' }
const token = { value: 'test-token', expiresAt: Date.now() + 3600_000 }
const storage = new Map()
const originalFetch = globalThis.fetch

before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    define: { 'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify('test-client') } })
  auth = await server.ssrLoadModule('/src/google/auth.ts')
  worker = (await server.ssrLoadModule('/worker/index.ts')).default
  drive = await server.ssrLoadModule('/src/google/drive.ts')
  encryption = await server.ssrLoadModule('/src/encryption.ts')
})
beforeEach(() => {
  storage.clear()
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  }
  globalThis.fetch = originalFetch
})
after(async () => { globalThis.fetch = originalFetch; delete globalThis.localStorage; delete globalThis.window; await server?.close() })

test('persisting a session never writes its bearer token to localStorage', () => {
  auth.storeSession({ token, profile })
  assert.ok(!JSON.stringify([...storage.values()]).includes('test-token'))
  assert.equal(auth.loadSession()?.profile.email, 'a@example.com')
})

test('loading a legacy session removes its stored bearer token', () => {
  storage.set('we-wealth.session', JSON.stringify({ token, profile }))
  const session = auth.loadSession()
  assert.equal(session?.token, undefined)
  assert.ok(!JSON.stringify([...storage.values()]).includes('test-token'))
  storage.set('we-wealth.session', '{"token":"test-token"')
  assert.equal(auth.loadSession(), null)
  assert.equal(storage.has('we-wealth.session'), false)
})

test('a renewed token from another Google account cannot be used to save existing data', async () => {
  globalThis.window = { google: { accounts: { oauth2: {
    initTokenClient: ({ callback }) => ({ requestAccessToken: () => callback({ access_token: 'other-token', expires_in: 3600 }) }),
    hasGrantedAllScopes: () => true,
  } } } }
  globalThis.fetch = async () => Response.json({ sub: 'account-b', email: profile.email, name: 'Bob' })
  await assert.rejects(() => auth.renewAccessToken(profile), /帳號/)
})

test('a renewed token from the same account is accepted', async () => {
  globalThis.window = { google: { accounts: { oauth2: {
    initTokenClient: ({ callback }) => ({ requestAccessToken: () => callback({ access_token: 'same-token', expires_in: 3600 }) }),
    hasGrantedAllScopes: () => true,
  } } } }
  globalThis.fetch = async () => Response.json(profile)
  assert.equal((await auth.renewAccessToken(profile)).value, 'same-token')
})

test('userinfo without a stable account identifier is rejected', async () => {
  globalThis.fetch = async () => Response.json({ email: 'a@example.com', name: 'Alice' })
  await assert.rejects(() => auth.fetchProfile(token))
})

test('HTML responses prevent framing and restrict script execution', async () => {
  const response = await worker.fetch(new Request('https://example.com/'), {
    ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }) },
  })
  const csp = response.headers.get('Content-Security-Policy') ?? ''
  assert.match(csp, /frame-ancestors 'none'/)
  assert.match(csp, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/)
  assert.ok(!csp.split(';').find((part) => part.includes('script-src'))?.includes('unsafe-inline'))
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
})

test('Drive saves encrypted content and never sends its key or password', async () => {
  const password = 'a unique financial password'
  const context = await encryption.createEncryption(password)
  const data = { version: 1, accounts: [{ name: 'Private account', quantity: 321 }] }
  let uploaded
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).hostname, 'www.googleapis.com')
    assert.equal(init.method, 'PATCH')
    assert.equal(init.headers.Authorization, 'Bearer test-token')
    assert.ok(!String(init.body).includes('Private account'))
    assert.ok(!String(init.body).includes(password))
    uploaded = JSON.parse(init.body)
    return Response.json({ id: 'file-a' })
  }
  assert.equal(await drive.saveData(token, data, 'file-a', context), 'file-a')
  assert.deepEqual((await encryption.decryptData(uploaded, password)).data, data)
})

test('encrypted Drive files wait for decryption before data validation', async () => {
  const password = 'a unique financial password'
  const data = { accounts: ['private'] }
  const encrypted = await encryption.encryptData(data, await encryption.createEncryption(password))
  globalThis.fetch = async (url) => new URL(url).searchParams.has('alt')
    ? Response.json(encrypted) : Response.json({ files: [{ id: 'file-a' }] })
  const file = await drive.loadData(token, async (raw) => (await encryption.decryptData(raw, password)).data)
  assert.deepEqual(file, { fileId: 'file-a', data })
  await assert.rejects(() => drive.loadData(token, async (raw) => (await encryption.decryptData(raw, 'wrong')).data))
})

test('legacy plaintext Drive files remain readable', async () => {
  const data = { version: 1, accounts: [] }
  globalThis.fetch = async (url) => new URL(url).searchParams.has('alt')
    ? Response.json(data) : Response.json({ files: [{ id: 'file-a' }] })
  assert.deepEqual(await drive.loadData(token, (raw) => raw), { fileId: 'file-a', data })
})

test('failed encrypted uploads never retry with plaintext', async () => {
  const context = await encryption.createEncryption('a unique financial password')
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    calls++
    assert.ok(!init.body.includes('private-account'))
    return new Response('Unavailable', { status: 503 })
  }
  await assert.rejects(() => drive.saveData(token, { name: 'private-account' }, 'file-a', context))
  assert.equal(calls, 1)
})

test('invalid quote symbols cannot turn the proxy into an arbitrary URL fetcher', async () => {
  globalThis.fetch = async () => { assert.fail('invalid symbols must not reach the network') }
  const response = await worker.fetch(new Request('https://example.com/api/quote?symbol=https://evil.example'), {})
  assert.equal(response.status, 404)
})
