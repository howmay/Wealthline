import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
let server, estimateLoan
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  ;({ estimateLoan } = await server.ssrLoadModule('/src/loanEstimate.ts'))
})
after(() => server.close())
const input = (over = {}) => ({ principal: 1200, annualRate: 12, periods: 12, method: 'annuity', ...over })
const close = (a, b) => assert.ok(Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-10, `${a} != ${b}`)
test('annuity agrees with independently evaluated standard formula and conserves principal', () => {
  const original = input(), result = estimateLoan(original)
  const expected = 1200 * .01 * 1.01 ** 12 / (1.01 ** 12 - 1)
  close(result.regularPayment, expected)
  for (const row of result.rows) {
    close(row.payment, expected)
    close(row.payment, row.principal + row.interest)
    close(row.openingBalance - row.principal, row.closingBalance)
    assert.ok(row.closingBalance >= 0)
  }
  close(result.rows.reduce((n, r) => n + r.principal, 0), 1200)
  close(result.totalInterest, expected * 12 - 1200)
  assert.equal(result.rows.at(-1).closingBalance, 0)
  assert.deepEqual(original, input())
})
test('equal principal has declining payments and independently known interest sum', () => {
  const result = estimateLoan(input({ method: 'equalPrincipal' }))
  assert.equal(result.regularPayment, null)
  assert.equal(result.rows[0].payment, 112)
  assert.equal(result.rows.at(-1).payment, 101)
  assert.equal(result.totalInterest, 78)
  assert.equal(result.totalPayment, 1278)
  assert.ok(result.rows.every((r, i) => r.principal === 100 && (!i || r.payment < result.rows[i - 1].payment)))
})
test('zero rate, zero balance and single period are exact', () => {
  for (const method of ['annuity', 'equalPrincipal']) {
    const zeroRate = estimateLoan(input({ method, annualRate: 0 }))
    assert.equal(zeroRate.totalInterest, 0)
    assert.ok(zeroRate.rows.every(r => r.payment === 100))
    assert.equal(estimateLoan(input({ method, principal: 0 })).totalPayment, 0)
    assert.deepEqual(estimateLoan(input({ method, periods: 1 })).rows[0], { period: 1, openingBalance: 1200, principal: 1200, interest: 12, payment: 1212, closingBalance: 0 })
  }
})
test('invalid inputs and unbounded periods fail before generating schedules', () => {
  for (const periods of [0, -1, 1.5, NaN, Infinity, 1201, Number.MAX_SAFE_INTEGER]) assert.throws(() => estimateLoan(input({ periods })), /剩餘期數/)
  for (const principal of [-1, Infinity, NaN]) assert.throws(() => estimateLoan(input({ principal })), /本金/)
  for (const annualRate of [-1, Infinity, NaN]) assert.throws(() => estimateLoan(input({ annualRate })), /年利率/)
  assert.throws(() => estimateLoan(input({ method: 'none' })), /還款方式/)
  assert.throws(() => estimateLoan(input({ principal: 1e308, annualRate: 1e308 })), /超出/)
})
test('tiny rates and long schedules retain positive interest without exponent overflow', () => {
  const tiny = estimateLoan(input({ annualRate: 1e-12, periods: 1200 }))
  assert.ok(tiny.totalInterest > 0)
  close(tiny.regularPayment, 1)
  for (const method of ['annuity', 'equalPrincipal']) {
    const result = estimateLoan(input({ method, annualRate: 120, periods: 1200 }))
    assert.equal(result.rows.length, 1200)
    assert.ok(Number.isFinite(result.totalPayment))
    close(result.rows.reduce((sum, row) => sum + row.principal, 0), 1200)
    assert.equal(result.rows.at(-1).closingBalance, 0)
  }
})
