import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, history, model

before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  history = await server.ssrLoadModule('/src/history.ts')
  model = await server.ssrLoadModule('/src/model.ts')
})
after(() => server.close())

const holding = (over = {}) => ({ id: 'h1', type: 'holding', currency: 'USD', symbol: 'AAPL', quantity: 10, price: 200, ...over })
const data = (positions, over = {}) => ({
  ...model.emptyData(),
  fxRates: { USD: 32 },
  accounts: [{ id: 'a1', name: 'Broker', kind: 'investment', country: 'US', category: '海外股票 (美股)', positions }],
  ...over,
})

test('a new holding is stamped with the save time and valued in the day record', () => {
  const at = '2026-10-08T02:00:00.000Z'
  const next = history.recordSave(null, data([holding()], { updatedAt: at }))
  assert.equal(next.accounts[0].positions[0].addedAt, at)
  const [snap] = next.history.snapshots
  assert.deepEqual(snap.positions, [
    { accountId: 'a1', type: 'holding', symbol: 'AAPL', currency: 'USD', quantity: 10, price: 200, rate: 32, value: 64000 },
  ])
})

test('a holding saved before stamps were kept takes its time from the change log, or stays unknown', () => {
  const addedAt = '2026-09-01T00:00:00.000Z'
  const log = { at: addedAt, accountId: 'a1', account: 'Broker', type: 'holding', symbol: 'AAPL', currency: 'USD', before: null, after: { quantity: 10, price: 200 } }
  const saved = data([holding(), holding({ id: 'h2', symbol: 'MSFT' })], { history: { changes: [log], snapshots: [] } })
  const next = history.recordSave(saved, { ...saved, updatedAt: '2026-10-08T02:00:00.000Z' })
  assert.equal(next.accounts[0].positions[0].addedAt, addedAt)
  assert.equal(next.accounts[0].positions[1].addedAt, undefined)
})

test('positionHistory follows one holding across days and skips days without it', () => {
  const p = holding()
  const d1 = history.recordSave(null, data([p], { updatedAt: '2026-10-06T02:00:00.000Z' }))
  const d2 = history.recordSave(d1, { ...d1, accounts: [{ ...d1.accounts[0], positions: [{ ...p, price: 210 }] }], updatedAt: '2026-10-07T02:00:00.000Z' })
  const old = { ...d2.history.snapshots[0], date: '2026-10-05', positions: [] }
  const points = history.positionHistory([old, ...d2.history.snapshots], 'a1', p)
  assert.deepEqual(points.map((x) => [x.date, x.v.value]), [['2026-10-06', 64000], ['2026-10-07', 67200]])
})

test('stored day records round-trip through the parser, and older ones without positions still load', () => {
  const next = history.recordSave(null, data([holding()], { updatedAt: '2026-10-08T02:00:00.000Z' }))
  const parsed = model.parseWealthData(JSON.parse(JSON.stringify(next)))
  assert.deepEqual(parsed.history.snapshots, next.history.snapshots)
  assert.equal(parsed.accounts[0].positions[0].addedAt, '2026-10-08T02:00:00.000Z')
  const legacy = JSON.parse(JSON.stringify(next))
  delete legacy.history.snapshots[0].positions
  assert.deepEqual(model.parseWealthData(legacy).history.snapshots[0].positions, [])
})
