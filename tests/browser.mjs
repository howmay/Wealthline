// Local manual fixture: fake Google responses only. Never shipped by the production entry.
const profile = { sub: 'fixture-account', email: 'fixture@example.com', name: 'Security fixture' }
const key = 'wewealth.security-fixture'
let content = sessionStorage.getItem(key) ?? JSON.stringify({
  version: 1, updatedAt: new Date().toISOString(), accounts: [], fxRates: {}, fxManual: [],
  fxUpdatedAt: new Date().toISOString(), history: { changes: [], snapshots: [] },
})
let failUpload = new URL(location.href).searchParams.has('failUpload')
window.google = { accounts: { oauth2: {
  initTokenClient: ({ callback }) => ({ requestAccessToken: () => callback({ access_token: 'fixture-token', expires_in: 3600 }) }),
  hasGrantedAllScopes: () => true,
  revoke: () => { throw new Error('Simulated network failure') },
} } }
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input), location.href)
  if (url.origin === location.origin) return originalFetch(input, init)
  if (url.hostname !== 'www.googleapis.com') throw new Error('Fixture blocks external requests')
  if (url.pathname.endsWith('/userinfo')) return Response.json(profile)
  if (init.method === 'PATCH') {
    content = init.body
    sessionStorage.setItem(key, content)
    if (failUpload) { failUpload = false; return new Response('Simulated lost response after upload', { status: 503 }) }
    return Response.json({ id: 'fixture-file' })
  }
  if (url.searchParams.get('alt') === 'media') return new Response(content)
  return Response.json({ files: [{ id: 'fixture-file' }] })
}
await import('/src/main.tsx')
