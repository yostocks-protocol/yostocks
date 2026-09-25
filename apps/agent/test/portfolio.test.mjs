// Unit: average-cost ledger and PnL series, on the wallet's real mainnet order history.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ledger, pnlSeries, intervalFor } from '../portfolio.mjs'

const USDT = '0x55d398326f99059fF775485246999027B3197955'
const U = '0xcE24439F2D9C6a2289F741120FE202248B666666'
const NVDAB = '0xnvdab'
const o = (bookTime, fromToken, fromTokenQty, toToken, toTokenActualQty) => ({ bookTime, fromToken, fromTokenQty, toToken, toTokenActualQty })
const ORDERS = [
  o('2026-09-24T12:48:08Z', USDT, '5', NVDAB, '0.02240984'),
  o('2026-09-24T14:22:22Z', USDT, '0.5', U, '0.5'), // stable → stable: not a stock trade
  o('2026-09-25T11:39:57Z', NVDAB, '0.022409', USDT, '5.06510442'),
  o('2026-09-25T11:41:00Z', USDT, '5', NVDAB, '0.02211944'),
]
const isStock = (a) => a === NVDAB

test('ledger: buy, sell at average cost books realized PnL, rebuy starts a fresh cost basis', () => {
  const { byToken, events } = ledger(ORDERS, isStock)
  const p = byToken[NVDAB]
  assert.equal(events.length, 3, 'stable swaps are ignored')
  // Sold 0.022409 of 0.02240984 bought for $5 → cost ≈ 4.99981, received 5.0651.
  assert.ok(Math.abs(p.realized - (5.06510442 - 5 * (0.022409 / 0.02240984))) < 1e-9)
  // The 0.00000084 dust left keeps its tiny cost; the rebuy adds $5.
  assert.ok(Math.abs(p.qty - (0.02240984 - 0.022409 + 0.02211944)) < 1e-12)
  assert.ok(Math.abs(p.cost - (5 + 5 * (0.00000084 / 0.02240984))) < 1e-9)
})

test('ledger: selling more than the ledger knows (tokens transferred in) never goes negative', () => {
  const { byToken } = ledger([o('2026-01-01T00:00:00Z', USDT, '10', NVDAB, '1'), o('2026-01-02T00:00:00Z', NVDAB, '3', USDT, '33')], isStock)
  assert.deepEqual(byToken[NVDAB], { qty: 0, cost: 0, realized: 23 })
})

test('pnlSeries: value − cost + realized at each candle, zero before the first buy', () => {
  const { events } = ledger([o('1970-01-01T02:00:00Z', USDT, '10', NVDAB, '2'), o('1970-01-01T04:00:00Z', NVDAB, '2', USDT, '14')], isStock)
  const h = 36e5
  const prices = { [NVDAB]: [[1 * h, 5], [2 * h, 5], [3 * h, 6], [4 * h, 7], [5 * h, 9]] }
  assert.deepEqual(pnlSeries(events, prices, 10 * h).map((p) => [p.t / h, p.pnl]), [[1, 0], [2, 0], [3, 2], [4, 4], [5, 4]])
  assert.deepEqual(pnlSeries([], prices), [])
})

test('intervalFor: at most 300 candles cover the history', () => {
  for (const days of [0.1, 12, 13, 50, 51, 290]) {
    const [, ms] = intervalFor(days * 864e5)
    assert.ok(days * 864e5 / ms <= 300, `${days}d`)
  }
})
