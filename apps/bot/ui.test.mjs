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
  const handled = ['quote', 'buy', 'sell', 'analyze', 'macro', 'strategy', 'strategies', 'stop', 'start']
  assert.deepEqual(ui.COMMANDS.map((c) => c.command).sort(), handled.sort())
  for (const c of ui.COMMANDS) {
    assert.match(c.command, /^[a-z0-9_]{1,32}$/)
    assert.ok(c.description.length >= 1 && c.description.length <= 256, c.command)
  }
  assert.ok(ui.DESCRIPTION.length <= 512)
  assert.ok(ui.SHORT_DESCRIPTION.length <= 120)
})

test('sell card and sold receipt', () => {
  const row = { t: { type: 3, symbol: 'NVDAB' }, multiplier: 1.000778223752807865 }
  const s = { ticker: 'NVDA', ref: 222.31, row, qty: '0.022409841731513969', usdtOut: 4.9889, ok: true, perShare: 222.45, dev: 0.06 }
  const c = ui.sellCard(s, { ask: true, company: 'Nvidia Corp' })
  assert.match(c, /<b>NVDA<\/b> · Nvidia Corp · sell/)
  assert.match(c, /Selling <b>0\.022410 NVDAB<\/b> \(bStocks\)/)
  assert.match(c, /Sell price <b>\$222\.45<\/b> \/ share · \+0\.06%/)
  assert.match(c, /You receive ≈ <b>4\.9889 USDT<\/b>/)
  assert.match(ui.sellCard({ ...s, ok: false, why: 'Please trade during <stock> market opening hours.' }), /⛔ <b>Not selling\.<\/b> <i>Please trade during &lt;stock&gt;/)
  assert.equal(ui.sellButtons('x', s.qty, 'NVDAB').inline_keyboard[0][0].text, '✅ Sell 0.022410 NVDAB → USDT')
  const r = ui.sellReceipt({ ...s, company: 'Nvidia Corp', got: '4.98', tx: 'https://bscscan.com/tx/0x5e11', orderId: 's-1' })
  assert.match(r, /✅ <b>Sold<\/b>[\s\S]*<b>4\.9800 USDT<\/b> for 0\.022410 NVDAB\nNvidia Corp \(NVDA\) on bStocks/)
  assert.match(r, /Avg price: <b>\$222\.05<\/b> \/ share \(−0\.12% vs NVDA\)/)
})

test('market card: human summary from the real CMC payload, with a sentiment takeaway, no raw JSON', async () => {
  const { snapshot } = await import('../agent/cmc.mjs')
  const { readFileSync } = await import('node:fs')
  const raw = JSON.parse(readFileSync(new URL('../agent/test/fixtures/cmc-global.json', import.meta.url), 'utf8'))
  const c = ui.marketCard({ snapshot: snapshot(raw), raw, paid: '0.01 U', flowId: '7eb5bf66-x' })
  assert.match(c, /😊 Sentiment: <b>Greed<\/b> \(74\/100\) · last week 64/)
  assert.match(c, /💰 Market cap: <b>\$2\.88T<\/b> · \+0\.39% today, \+10\.70% this week/)
  assert.match(c, /📊 24h volume: <b>\$104B<\/b> \(−8\.98%\)/)
  assert.match(c, /₿ BTC dominance: <b>58\.9%<\/b> · ETH 11\.4%/)
  assert.match(c, /🔄 Altcoin season: <b>55\/100<\/b> \(yesterday 45\)/)
  assert.match(c, /📈 Open interest: <b>\$394\.88B<\/b> \(−11\.01%\)/)
  assert.match(c, /<b>What it means:<\/b> Greed: risk appetite is high/)
  assert.match(c, /✅ Paid <b>0\.01 U<\/b> over x402 · <code>7eb5bf66<\/code>/)
  assert.ok(!/[{}]|object Object/.test(c))
})

test('market card falls back to sections, then to a plain message; never "[object Object]"', () => {
  const c = ui.marketCard({ sections: [{ title: 'Market size', items: [{ label: 'Total crypto market cap', current: '2.88 T', change24h: '+0.39%' }] }], paid: '0.01 U' })
  assert.match(c, /<b>Market size<\/b>\n• Total crypto market cap: <b>2\.88 T<\/b>/)
  assert.match(ui.marketCard({ partial: true, paid: '0.01 U' }), /closed the connection/)
})

test('macro card from the real paid calendar: headline, high-impact events, Fed, US-stock takeaway, tx link', async () => {
  const { digest } = await import('../agent/macro.mjs')
  const { readFileSync } = await import('node:fs')
  const raw = JSON.parse(readFileSync(new URL('../agent/test/fixtures/macro-calendar.json', import.meta.url), 'utf8'))
  const c = ui.macroCard({ ...digest(raw), paid: '0.1 USD1', tx: '0xe21fbbfe6d033971d8f12542e858f39a1969586b9161c3a8397dffeb4f76387a' })
  assert.match(c, /🗓 <b>Macro week of 2026-09-21<\/b>/)
  assert.match(c, /🔴 Wednesday · SNB Rate Decision \(Swiss National Bank\) \(CHF\)/)
  assert.match(c, /🏦 Fed: next decision <b>2026-10-28<\/b> · rate 3\.875%/)
  assert.match(c, /no high-impact US releases this week/)
  assert.match(c, /bscscan\.com\/tx\/0xe21fbbfe/)
  assert.ok(!/[{}]|object Object/.test(c))
  const hot = ui.macroCard({ week: 'w', events: [{ day: 'Wednesday', event: 'US CPI', currency: 'USD', impact: 'high' }], paid: '0.1 USD1' })
  assert.match(hot, /1 high-impact US release this week\. Expect bigger swings around Wednesday/)
})

test('x402 merchant rejections read as "nothing was charged" with the provider reason', () => {
  const settle = ui.problem('macropulse.theaslangroupllc.com rejected the paid request (USD1 via eip3009): 402 {"error":"settlement_failed","reason":"invalid_transaction_state"}')
  assert.match(settle, /Payment didn't go through, nothing was charged[\s\S]*settlement_failed \(invalid_transaction_state\)/)
  const rej = ui.problem('stock-agent.bnbchain.org rejected the paid request (U via eip3009): 402 {"errorCode": "payment_rejected"} {"success":false}')
  assert.match(rej, /nothing was charged[\s\S]*payment_rejected/)
  assert.match(ui.problem('swap rejected: boom'), /Something went wrong/)
})
