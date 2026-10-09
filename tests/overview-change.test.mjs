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

test("today's point is the live total and replaces a saved record for the same day", () => {
  const data = {
    ...model.emptyData(),
    accounts: [{ id: 'a1', name: 'Bank', kind: 'bank', country: 'TW', category: '現金與外幣活存', positions: [{ id: 'p1', type: 'cash', currency: 'TWD', symbol: '', quantity: 500, price: 1 }] }],
  }
  const now = '2026-10-09T04:00:00.000Z'
  const day = history.localDate(now)
  data.history.snapshots = [
    { date: '2026-10-07', at: '2026-10-07T04:00:00.000Z', total: 100, accounts: [], categories: {} },
    { date: day, at: now, total: 200, accounts: [], categories: {} },
  ]
  const points = history.totalPoints(data, now)
  assert.deepEqual(points.map((p) => [p.date, p.total]), [['2026-10-07', 100], [day, 500]])
})
