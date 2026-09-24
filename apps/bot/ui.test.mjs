// Unit: message templates. Numbers from the first mainnet buy (2026-09-24, tx 0xfe3a3f…04b9).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as ui from './ui.mjs'

const best = { t: { type: 3, symbol: 'NVDAB' }, ok: true, multiplier: 1.000778223752807865, perShare: 222.93, dev: -0.12, got: 0.022412 }
const first = { ticker: 'NVDA', usdt: 5, ref: 223.19, best, got: '0.022409841731513969', tx: 'https://bscscan.com/tx/0xfe3a3f460a2f278ec91f8dfc550043bf5ed8d9726952bcceb572ace52ef404b9', orderId: '26092400001912775002' }

test('receipt: amount, average price per share (multiplier applied) and gap to the real price', () => {
  const r = ui.receipt(first)
  assert.match(r, /<b>0\.022410 NVDAB<\/b> · NVDA on bStocks/)
  assert.match(ui.receipt({ ...first, company: 'Nvidia Corp' }), /<b>0\.022410 NVDAB<\/b> · Nvidia Corp \(NVDA\) on bStocks/)
  assert.match(r, /Paid: <b>5\.00 USDT<\/b>/)
  assert.match(r, /Avg price: <b>\$222\.94<\/b> \/ share \(−0\.11% vs NVDA\)/) // 5 / (0.02241 × 1.000778)
  assert.match(r, /<a href="https:\/\/bscscan\.com\/tx\/0xfe3a3f/)
  assert.match(r, /<code>Order 26092400001912775002<\/code>/)
  assert.ok(r.length < 1024)
})

test('quote card puts the best route first, then safe, then rejected; escapes provider text', () => {
  const rows = [
    { t: { type: 2, symbol: 'NVDAx' }, ok: false, why: 'No <liquidity>' },
    { t: { type: 1, symbol: 'NVDAon' }, ok: true, perShare: 223.92, dev: 0.32 },
    best,
  ]
  const c = ui.quoteCard({ ticker: 'NVDA', usdt: 5, ref: 223.19, rows, best })
  assert.ok(c.indexOf('NVDAB') < c.indexOf('NVDAon') && c.indexOf('NVDAon') < c.indexOf('NVDAx'))
  assert.match(c, /\$223\.92 \/ share · \+0\.32%/)
  assert.match(c, /\$222\.93 \/ share · −0\.12% · <i>best route<\/i>/)
  assert.match(c, /No &lt;liquidity&gt;/)
  assert.match(ui.quoteCard({ ticker: 'NVDA', usdt: 5, ref: 1, rows: [], best: undefined }), /No safe route right now/)
})

test('problem(): expired wallet sessions get a clear sign-in hint, other errors are escaped', () => {
  assert.match(ui.problem('Agentic Wallet SESSION_EXPIRED: run `baw auth signin`'), /Wallet session expired[\s\S]*baw auth signin/)
  assert.match(ui.problem('swap rejected: <x>'), /<code>swap rejected: &lt;x&gt;<\/code>/)
})

test('strategy list shows ids and bullet points, or a hint when empty', () => {
  assert.match(ui.strategyList([{ id: 'ab12', description: 'Buy 10 USDT of NVDA every day\n· skip while earnings limits are active' }]), /<code>#ab12<\/code>\nBuy 10 USDT[\s\S]*\n• skip while/)
  assert.match(ui.strategyList([]), /No strategies yet/)
})

test('command menu fits Telegram limits and matches what the bot handles', () => {
  const handled = ['quote', 'buy', 'strategy', 'strategies', 'stop', 'start']
  assert.deepEqual(ui.COMMANDS.map((c) => c.command).sort(), handled.sort())
  for (const c of ui.COMMANDS) {
    assert.match(c.command, /^[a-z0-9_]{1,32}$/)
    assert.ok(c.description.length >= 1 && c.description.length <= 256, c.command)
  }
  assert.ok(ui.DESCRIPTION.length <= 512)
  assert.ok(ui.SHORT_DESCRIPTION.length <= 120)
})
