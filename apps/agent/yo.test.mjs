// Unit: guard rules and output formatting. Pure functions, no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judge, format } from './yo.mjs'

const q = (amt) => ({ success: true, data: { toCoinAmount: String(amt) } })
const ok = { reasonCode: 'TRADING' }
const row = (amt, extra = {}) => ({ usdt: 100, quote: q(amt), multiplier: 1, status: ok, ...extra })

test('fair quote passes and reports per-share price', () => {
  const r = judge({ usdt: 100, quote: q(0.449), multiplier: 1.0017, status: ok }, 222.4)
  assert.equal(r.ok, true)
  assert.ok(Math.abs(r.perShare - 222.33) < 0.01)
  assert.ok(Math.abs(r.dev) < 0.5)
})

test('deviation boundary: just inside max passes, just over fails, both directions', () => {
  // perShare = 100 / got; ref 100 → dev = 100/got - 100 (%)
  assert.equal(judge(row(100 / 100.99), 100, 1).ok, true) // +0.99%
  assert.equal(judge(row(100 / 101.01), 100, 1).ok, false) // +1.01%
  assert.equal(judge(row(100 / 99.01), 100, 1).ok, true) // -0.99%
  assert.equal(judge(row(100 / 98.9), 100, 1).ok, false) // -1.10%, suspiciously cheap is rejected too
})

test('multiplier converts tokens to shares (split token = 10 shares)', () => {
  // 100 USDT buys 0.04 tokens of a 10-share token → 0.4 shares → $250/share
  const r = judge({ ...row(0.04), multiplier: 10 }, 250)
  assert.equal(r.ok, true)
  assert.ok(Math.abs(r.perShare - 250) < 1e-9)
})

test('~0 or non-numeric output is rejected', () => {
  for (const amt of [0, '0', 'NaN', '']) assert.equal(judge(row(amt), 157).ok, false, `amt=${amt}`)
})

test('failed quote carries the provider message', () => {
  assert.equal(judge({ ...row(1), quote: { success: false, error: { message: 'No liquidity' } } }, 1).why, 'No liquidity')
  assert.equal(judge({ ...row(1), quote: undefined }, 1).why, 'no quote')
})

test('paused / unsupported / maintenance assets are rejected even with a fair quote', () => {
  for (const reasonCode of ['ASSET_PAUSED', 'UNSUPPORTED', 'MARKET_MAINTENANCE', 'MARKET_PAUSED']) {
    const r = judge({ ...row(0.449), status: { reasonCode, reasonMsg: 'stock_split' } }, 222.7)
    assert.equal(r.ok, false, reasonCode)
    assert.match(r.why, new RegExp(reasonCode))
  }
})

test('earnings-limited and closed markets are not blocked (tokens trade 24/7)', () => {
  for (const reasonCode of ['ASSET_LIMITED', 'MARKET_CLOSED', 'TRADING']) assert.equal(judge({ ...row(0.449), status: { reasonCode } }, 222.7).ok, true, reasonCode)
})

test('format marks best, ok and rejected rows', () => {
  const t = (type, symbol) => ({ type, symbol })
  const best = { t: t(3, 'MSTRB'), ok: true, perShare: 159.07, dev: 0.21, got: 0.628668 }
  const out = format({
    ticker: 'MSTR', usdt: 100, ref: 158.82, best,
    rows: [{ t: t(1, 'MSTRon'), ok: true, perShare: 159.11, dev: 0.25 }, { t: t(2, 'MSTRx'), ok: false, why: 'quote returns ~0 tokens' }, best],
  })
  assert.match(out, /MSTR · 100 USDT · reference \$158\.82\/share/)
  assert.match(out, /✓ Ondo +MSTRon +\$159\.11\/share \(\+0\.25%\)/)
  assert.match(out, /✗ xStocks +MSTRx +quote returns ~0 tokens/)
  assert.match(out, /★ bStocks +MSTRB/)
  assert.match(out, /best: MSTRB → 0\.628668 tokens/)
  assert.match(format({ ticker: 'X', usdt: 1, ref: 1, rows: [], best: undefined }), /no safe route, not trading/)
})
