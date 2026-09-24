import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judge } from './yo.mjs'

const q = (amt) => ({ success: true, data: { toCoinAmount: String(amt) } })
const ok = { reasonCode: 'TRADING' }

test('fair quote passes', () => {
  const r = judge({ usdt: 100, quote: q(0.449), multiplier: 1.0017, status: ok }, 222.4)
  assert.equal(r.ok, true)
  assert.ok(Math.abs(r.dev) < 0.5)
})
test('~0 output quote (MSTRx case) is rejected', () => {
  assert.equal(judge({ usdt: 100, quote: q(0.00000002), multiplier: 1, status: ok }, 157).ok, false)
  assert.equal(judge({ usdt: 100, quote: q(0), multiplier: 1, status: ok }, 157).ok, false)
})
test('quote far from reference is rejected', () => {
  assert.equal(judge({ usdt: 100, quote: q(0.1747), multiplier: 1, status: ok }, 723.6).ok, false) // META @ $572
})
test('no liquidity / paused asset rejected', () => {
  assert.equal(judge({ usdt: 100, quote: { success: false, error: { message: 'No liquidity' } }, multiplier: 1, status: ok }, 1).why, 'No liquidity')
  assert.equal(judge({ usdt: 100, quote: q(0.449), multiplier: 1, status: { reasonCode: 'ASSET_PAUSED', reasonMsg: 'stock_split' } }, 222).ok, false)
})
