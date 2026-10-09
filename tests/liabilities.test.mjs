import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, model, debts, history, saveState, importer
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  model = await server.ssrLoadModule('/src/model.ts')
  debts = await server.ssrLoadModule('/src/liabilities.ts')
  history = await server.ssrLoadModule('/src/history.ts')
  saveState = await server.ssrLoadModule('/src/saveState.ts')
  importer = await server.ssrLoadModule('/src/importSheet.ts')
})
after(() => server.close())
// Synthetic examples only; no receipt data or identifiers.
const debt = (over = {}) => ({ id: 'synthetic-debt', name: '測試貸款', kind: 'personal', currency: 'TWD', balance: 800, ...over })
const fixture = () => ({ ...model.emptyData(), fxRates: { USD: 30, USDC: 31 }, accounts: [{ id: 'synthetic-account', name: '測試帳戶', kind: 'bank', country: 'TW', category: '現金', positions: [{ id: 'synthetic-cash', type: 'cash', currency: 'TWD', symbol: '', quantity: 500, price: 1 }] }] })

test('old JSON stays readable, old snapshots remain unknown, next save writes protected v2', () => {
  const legacy = { ...fixture(), version: 1, updatedAt: '2025-01-01T12:00:00Z' }
  delete legacy.liabilities
  legacy.history.snapshots = [{ date: '2025-01-01', at: legacy.updatedAt, total: 500, accounts: [], categories: {} }]
  const loaded = model.parseWealthData(legacy)
  assert.equal(loaded.liabilities, undefined)
  assert.equal(loaded.history.snapshots[0].liabilityTotal, undefined)
  assert.equal(debts.balanceSheet(loaded).net, 500)
  const saved = history.recordSave(loaded, { ...loaded, updatedAt: '2025-01-02T12:00:00Z' })
  assert.equal(saved.version, 2)
  assert.deepEqual(saved.liabilities, [])
  assert.equal(saved.history.snapshots[0].netWorth, undefined)
  assert.equal(saved.history.snapshots[1].liabilityTotal, 0)
  assert.equal(saved.history.snapshots[1].netWorth, 500)
  assert.doesNotThrow(() => model.parseWealthData(JSON.parse(JSON.stringify(saved))))
})

test('multicurrency positive debts subtract once, net worth can be negative, asset allocation stays unchanged', () => {
  const data = { ...fixture(), liabilities: [debt(), debt({ id: 'usd-debt', currency: 'USD', balance: 10 }), debt({ id: 'stable-debt', currency: 'USDC', balance: 2 })] }
  assert.deepEqual(debts.balanceSheet(data), { assets: 500, liabilities: 1162, net: -662, missing: [] })
  assert.equal(model.breakdown(data, (a) => a.category).total, 500)
  assert.ok(model.usedCurrencies(data).includes('USDC'))
  assert.equal(history.snapshotOf(data, data.updatedAt).total, 500)
})

test('missing debt or asset rates produce unknown net worth instead of understated debt', () => {
  const data = { ...fixture(), liabilities: [debt({ currency: 'EUR' })] }
  assert.equal(debts.balanceSheet(data).liabilities, null)
  assert.equal(debts.balanceSheet(data).net, null)
  assert.deepEqual(debts.balanceSheet(data).missing, ['EUR'])
  assert.ok(model.missingRates(data).includes('EUR'))
  assert.equal(history.snapshotOf(data, data.updatedAt).netWorth, null)
  const refreshed = model.applyFetchedRates(data, { EUR: 40 }, data.updatedAt)
  assert.equal(debts.balanceSheet(refreshed).liabilities, 32000)
  data.liabilities[0].balance = 0
  assert.equal(debts.balanceSheet(data).liabilities, 0)
  data.accounts[0].positions[0].currency = 'JPY'
  assert.equal(debts.balanceSheet(data).net, null)
})

test('zero balance, zero interest and zero paid installments survive; payment is never inferred as principal', () => {
  const d = debt({ balance: 0, annualRate: 0, paymentAmount: 20, totalInstallments: 24, paidInstallments: 0, nextDueDate: '2028-02-29', notes: '合成資料' })
  assert.deepEqual(debts.parseLiability(d), d)
  assert.equal(debts.balanceSheet({ ...fixture(), liabilities: [d] }).liabilities, 0)
  assert.equal(debts.parseLiability({ ...d, paidInstallments: 24, balance: 9 }).balance, 9)
})

test('invalid debt values, types, dates, installments and duplicate IDs fail before persistence', () => {
  for (const change of [{ balance: -1 }, { balance: NaN }, { balance: Infinity }, { annualRate: -1 }, { paymentAmount: -1 }, { totalInstallments: 0 }, { paidInstallments: 1.5 }, { totalInstallments: 10, paidInstallments: 11 }, { nextDueDate: '2025-02-29' }, { nextDueDate: '2026-13-01' }, { kind: 'constructor' }, { currency: 'UNKNOWN' }, { name: ' ' }, { notes: 123 }]) {
    assert.throws(() => debts.parseLiability(debt(change)))
  }
  assert.throws(() => model.parseWealthData({ ...fixture(), liabilities: [debt(), debt()] }), /識別碼重複/)
  assert.throws(() => model.parseWealthData({ ...fixture(), liabilities: undefined }), /負債/)
})

test('debt additions, edits including metadata, removals, and revert are recorded independently of assets', () => {
  const initial = fixture()
  const next = { ...initial, liabilities: [debt()] }
  const added = history.pendingLiabilityChanges(initial, next)
  assert.equal(added.length, 1)
  assert.equal(added[0].before, null)
  assert.equal(history.pendingChanges(initial, next).length, 0)
  assert.deepEqual(history.revertLiabilityChange(initial, next, debt().id).liabilities, [])
  const saved = history.recordSave(initial, next)
  const edited = { ...saved, liabilities: [debt({ currency: 'USD', balance: 10, notes: '更新合成備註' })] }
  const changes = history.pendingLiabilityChanges(saved, edited)
  assert.equal(changes[0].before.currency, 'TWD')
  assert.equal(changes[0].after.currency, 'USD')
  assert.equal(changes[0].before.balance, 800)
  assert.equal(history.pendingLiabilityChanges(saved, { ...saved, liabilities: [debt({ notes: '只有備註改變' })] }).length, 1)
  const removed = { ...saved, liabilities: [] }
  assert.equal(history.pendingLiabilityChanges(saved, removed)[0].after, null)
  assert.deepEqual(history.revertLiabilityChange(saved, removed, debt().id).liabilities, [debt()])
  const parsed = model.parseWealthData(JSON.parse(JSON.stringify(history.recordSave(saved, edited))))
  assert.equal(parsed.history.liabilityChanges.length, 2)
  assert.deepEqual(parsed.history.liabilityChanges[1].after, edited.liabilities[0])
})

test('debt-only saves and deleting the last debt create snapshots, without adding debt to the asset chart', () => {
  const data = { ...model.emptyData(), liabilities: [debt()] }
  const saved = history.recordSave(null, data)
  assert.equal(saved.history.snapshots[0].total, 0)
  assert.equal(saved.history.snapshots[0].netWorth, -800)
  const removed = history.recordSave(saved, { ...saved, liabilities: [], updatedAt: new Date(Date.now() + 86400000).toISOString() })
  assert.equal(removed.history.snapshots.at(-1).liabilityTotal, 0)
  assert.equal(removed.history.snapshots.at(-1).netWorth, 0)
  assert.equal(history.totalPoints(saved, saved.updatedAt)[0].total, 0)
})

test('pending debt edits and deletions survive save completion and are logged only on the following save', () => {
  const submitted = { ...fixture(), liabilities: [debt()] }
  const persisted = history.recordSave(null, submitted)
  const current = { ...submitted, liabilities: [debt({ balance: 700 })] }
  const finished = saveState.finishSave(current, submitted, persisted)
  assert.equal(finished.liabilities[0].balance, 700)
  assert.equal(finished.history.liabilityChanges.at(-1).after.balance, 800)
  assert.equal(history.recordSave(persisted, finished).history.liabilityChanges.at(-1).after.balance, 700)
  const deleted = saveState.finishSave({ ...current, liabilities: [] }, submitted, persisted)
  assert.deepEqual(deleted.liabilities, [])
  const historyDeleted = { ...current, history: { ...current.history, liabilityChanges: [] } }
  assert.equal(saveState.finishSave(historyDeleted, submitted, persisted).history, historyDeleted.history)
})

test('asset sheet import preserves liabilities and debt history', () => {
  const data = history.recordSave(null, { ...fixture(), liabilities: [debt()] })
  const result = importer.importSheet(data, '合成匯入\t現金\t\tTWD\t10\t1')
  assert.equal(result.data.liabilities, data.liabilities)
  assert.equal(result.data.history.liabilityChanges, data.history.liabilityChanges)
})

test('loan assumptions validate separately and legacy manual data round trips unchanged', () => {
  const legacy = debt({ annualRate: 2, paymentAmount: 20, totalInstallments: 24, paidInstallments: 3 })
  assert.deepEqual(debts.parseLiability(legacy), legacy)
  const loan = debt({ repaymentMethod: 'annuity', annualRate: 0, remainingInstallments: 12 })
  assert.deepEqual(debts.parseLiability(loan), loan)
  for (const over of [{ annualRate: undefined }, { remainingInstallments: 0 }, { remainingInstallments: 1201 }, { repaymentMethod: 'unknown' }, { kind: 'credit' }]) assert.throws(() => debts.parseLiability({ ...loan, ...over }))
  const data = { ...fixture(), liabilities: [loan] }
  assert.equal(debts.balanceSheet(data).net, -300)
  const changed = { ...loan, annualRate: 20, remainingInstallments: 1, nextDueDate: '2000-01-01' }
  assert.equal(debts.balanceSheet({ ...data, liabilities: [changed] }).net, -300)
  assert.equal(history.diffLiabilities(data, { ...data, liabilities: [changed] }, data.updatedAt).length, 1)
})
