import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, history, model, timeline, worker

before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  history = await server.ssrLoadModule('/src/history.ts')
  model = await server.ssrLoadModule('/src/model.ts')
  timeline = await server.ssrLoadModule('/src/priceHistory.ts')
  worker = (await server.ssrLoadModule('/worker/index.ts')).default
})
after(() => server.close())

const holding = (over = {}) => ({ id: 'h1', type: 'holding', currency: 'USD', symbol: 'AAPL', quantity: 10, price: 200, ...over })
const data = (positions, over = {}) => ({
  ...model.emptyData(),
  fxRates: { USD: 32 },
  accounts: [{ id: 'a1', name: 'Broker', kind: 'investment', country: 'US', category: '海外股票 (美股)', positions }],
  ...over,
})
const change = (at, before, after) => ({ at, accountId: 'a1', account: 'Broker', type: 'holding', symbol: 'AAPL', currency: 'USD', before, after })
// Noon UTC stays on the same local date in any time zone the tests run in.
const noon = (d) => `${d}T12:00:00.000Z`

test('a new holding is stamped with the save time', () => {
  const at = '2026-10-08T02:00:00.000Z'
  const next = history.recordSave(null, data([holding()], { updatedAt: at }))
  assert.equal(next.accounts[0].positions[0].addedAt, at)
  assert.equal('positions' in next.history.snapshots[0], false)
})

test('a holding saved before stamps were kept takes its time from the change log, or stays unknown', () => {
  const addedAt = '2026-09-01T00:00:00.000Z'
  const log = change(addedAt, null, { quantity: 10, price: 200 })
  const saved = data([holding(), holding({ id: 'h2', symbol: 'MSFT' })], { history: { changes: [log], snapshots: [] } })
  const next = history.recordSave(saved, { ...saved, updatedAt: '2026-10-08T02:00:00.000Z' })
  assert.equal(next.accounts[0].positions[0].addedAt, addedAt)
  assert.equal(next.accounts[0].positions[1].addedAt, undefined)
  const parsed = model.parseWealthData(JSON.parse(JSON.stringify(next)))
  assert.equal(parsed.accounts[0].positions[0].addedAt, addedAt)
})

test('daily values combine past closes, past rates and the quantity held each day', () => {
  const p = holding({ quantity: 15, price: 210, addedAt: noon('2026-10-01') })
  const d = data([p], {
    history: {
      snapshots: [],
      changes: [change(noon('2026-10-01'), null, { quantity: 10, price: 190 }), change(noon('2026-10-05'), { quantity: 10, price: 190 }, { quantity: 15, price: 205 })],
    },
  })
  const prices = { asTraded: true, symbol: 'AAPL', currency: 'USD', points: [['2026-09-30', 1], ['2026-10-01', 190], ['2026-10-02', 195], ['2026-10-05', 205], ['2026-10-06', 202]].map(([date, close]) => ({ date, close })) }
  const fx = { asTraded: true, symbol: 'USDTWD=X', currency: 'TWD', points: [{ date: '2026-10-01', close: 31 }, { date: '2026-10-05', close: 32 }] }
  const { days, startKnown, incomplete } = timeline.positionTimeline(d, d.accounts[0], p, prices, fx, noon('2026-10-07'))
  assert.deepEqual(
    days.map((x) => [x.date, x.quantity, x.price, x.rate, x.value, !!x.live]),
    [
      ['2026-10-01', 10, 190, 31, 58900, false],
      ['2026-10-02', 10, 195, 31, 60450, false],
      ['2026-10-05', 15, 205, 32, 98400, false],
      ['2026-10-06', 15, 202, 32, 96960, false],
      ['2026-10-07', 15, 210, 32, 100800, true],
    ],
  )
  assert.equal(startKnown, true)
  assert.equal(incomplete, false)
})

test('without past prices historical values stay unknown despite recorded manual prices', () => {
  const p = holding({ currency: 'TWD', quantity: 2, price: 120, priceManual: true, addedAt: noon('2026-10-01') })
  const log = [
    { ...change(noon('2026-10-01'), null, { quantity: 1, price: 100 }), currency: 'TWD' },
    { ...change(noon('2026-10-03'), { quantity: 1, price: 100 }, { quantity: 2, price: 120 }), currency: 'TWD' },
  ]
  const d = data([p], { history: { snapshots: [], changes: log } })
  const { days } = timeline.positionTimeline(d, d.accounts[0], p, null, null, noon('2026-10-07'))
  assert.deepEqual(days.map((x) => [x.date, x.value]), [['2026-10-01', null], ['2026-10-03', null], ['2026-10-07', 240]])
})

test('the history relay rejects symbols and dates that are not plain values', async () => {
  for (const q of ['symbol=https://evil.example&from=2026-01-01', 'symbol=AAPL&from=yesterday']) {
    const res = await worker.fetch(new Request(`https://example.com/api/history?${q}`), {})
    assert.equal(res.status, 404)
  }
})

test('past closes are dated in the exchange time zone and skip empty days', async () => {
  const yahoo = await server.ssrLoadModule('/server/yahoo.ts')
  const original = globalThis.fetch
  // 2330.TW opens 09:00 in Taipei (UTC+8), which is 01:00 UTC the same day.
  const t = (d) => Date.parse(`${d}T01:00:00Z`) / 1000
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      chart: { result: [{ meta: { currency: 'TWD', symbol: '2330.TW', gmtoffset: 28800 }, timestamp: [t('2026-10-06'), t('2026-10-07'), t('2026-10-08')], indicators: { quote: [{ close: [1080, null, 1090] }] } }] },
    }))
  try {
    assert.deepEqual(await yahoo.yahooHistory('2330.TW', '2026-10-01'), {
      asTraded: true,
      splits: [],
      symbol: '2330.TW',
      currency: 'TWD',
      points: [{ date: '2026-10-06', close: 1080 }, { date: '2026-10-08', close: 1090 }],
    })
  } finally {
    globalThis.fetch = original
  }
})
