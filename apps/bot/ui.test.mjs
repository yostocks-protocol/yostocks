// Unit: message templates. Numbers from the first mainnet buy (2026-09-24, tx 0xfe3a3f…04b9).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as ui from './ui.mjs'

const best = { t: { type: 3, symbol: 'NVDAB' }, ok: true, multiplier: 1.000778223752807865, perShare: 222.93, dev: -0.12, got: 0.022412 }
const first = { ticker: 'NVDA', usdt: 5, ref: 223.19, best, got: '0.022409841731513969', tx: 'https://bscscan.com/tx/0xfe3a3f460a2f278ec91f8dfc550043bf5ed8d9726952bcceb572ace52ef404b9', orderId: '26092400001912775002' }

test('receipt in plain words: name, shares (multiplier applied), price per share vs the real price, tx link', () => {
  const r = ui.receipt(first)
  assert.match(r, /✅ <b>Done! You bought NVIDIA<\/b>/)
  assert.match(r, /0\.0224 shares for <b>\$5\.00<\/b>/)
  assert.match(r, /\$222\.94 per share, 0\.11% below the stock price/) // 5 / (0.02241 × 1.000778)
  assert.match(r, /<a href="https:\/\/bscscan\.com\/tx\/0xfe3a3f[^"]*">See the transaction/)
  assert.ok(!/NVDAB|bStocks|USDT|Order/.test(r), 'no jargon in the receipt')
  assert.match(ui.receipt({ ...first, ticker: 'AMD', company: 'Advanced Micro Devices Inc' }), /You bought Advanced Micro Devices</)
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
  assert.match(ui.problem('Agentic Wallet SESSION_EXPIRED: run `baw auth signin`'), /Please connect Binance again/)
  assert.match(ui.problem('swap rejected: <x>'), /<code>swap rejected: &lt;x&gt;<\/code>/)
})

test('strategy list shows ids and bullet points, or a hint when empty', () => {
  assert.match(ui.strategyList([{ id: 'ab12', description: 'Buy 10 USDT of NVDA every day\n· skip while earnings limits are active' }]), /<code>#ab12<\/code>\nBuy 10 USDT[\s\S]*\n• skip while/)
  assert.match(ui.strategyList([]), /No strategies yet/)
})

test('command menu fits Telegram limits and matches what the bot handles', () => {
  const handled = ['start', 'portfolio']
  assert.deepEqual(ui.COMMANDS.map((c) => c.command).sort(), handled.sort())
  for (const c of ui.COMMANDS) {
    assert.match(c.command, /^[a-z0-9_]{1,32}$/)
    assert.ok(c.description.length >= 1 && c.description.length <= 256, c.command)
  }
  assert.ok(ui.DESCRIPTION.length <= 512)
  assert.ok(ui.SHORT_DESCRIPTION.length <= 120)
})

test('sell card, sell button and sold receipt in plain words', () => {
  const row = { t: { type: 3, symbol: 'NVDAB' }, multiplier: 1.000778223752807865 }
  const s = { ticker: 'NVDA', ref: 222.31, row, qty: '0.022409841731513969', usdtOut: 4.9889, ok: true, perShare: 222.45, dev: 0.06 }
  const c = ui.sellCard(s, { company: 'Nvidia Corp' })
  assert.match(c, /<b>Sell NVIDIA\?<\/b>\n0\.0224 shares → about <b>\$4\.99<\/b>\n<i>That's 0\.06% above the stock price\.<\/i>/)
  assert.match(ui.sellCard({ ...s, ok: false, why: 'Please trade during stock market opening hours.' }), /⚠️ <b>Can't sell NVIDIA right now\.<\/b>\nThis version can only be sold while the US stock market is open\./)
  assert.equal(ui.sellButtons('x', s.usdtOut).inline_keyboard[0][0].text, '✅ Sell for ~$4.99')
  const r = ui.sellReceipt({ ...s, got: '4.98', tx: 'https://bscscan.com/tx/0x5e11' })
  assert.match(r, /✅ <b>Sold!<\/b> You got <b>\$4\.98<\/b>\nfor 0\.0224 NVIDIA shares\./)
})

test('stock card: name, price, one verdict line; provider details only behind Details', () => {
  const best = { t: { type: 3, symbol: 'NVDAB' }, ok: true, dev: 0.02 }
  const c = ui.stockCard({ ticker: 'NVDA', ref: 225.93, rows: [best], best })
  assert.match(c, /^<b>NVIDIA<\/b> · NVDA\n<b>\$225\.93<\/b>\n\n✅ <b>Fair price<\/b> · via bStocks, 0\.02% above the stock price$/)
  assert.match(ui.stockCard({ ticker: 'NVDA', ref: 1, rows: [], best: undefined }), /Buying paused/)
  assert.deepEqual(ui.stockButtons('i', 'NVDA', true).inline_keyboard.map((r) => r.map((b) => b.text)), [['Buy $5', 'Buy $10', 'Buy $25'], ['✏️ Other', 'ℹ️ Details', '🏠 Home'], ['🎯 Buy if it drops']])
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

test('home lists each stock with price and 24h change; nothing when prices are unavailable', () => {
  const h = ui.home([{ ticker: 'NVDA', price: 223.06, change: 1.234 }, { ticker: 'TSLA', price: 412.1, change: -0.8 }])
  assert.match(h, /<b>NVIDIA<\/b> · \$223\.06 · 🟢 \+1\.2%/)
  assert.match(h, /<b>Tesla<\/b> · \$412\.10 · 🔴 −0\.8%/)
  assert.ok(!/24h change/.test(ui.home([])))
})

test('stock card: what the company does, 24h change, and a facts table (market cap, 52-week, dividend, market hours)', () => {
  const dyn = {
    tokenInfo: { priceChangePct24h: '-4.24' },
    stockInfo: { price: '159.49', priceLow52w: '81.81', priceHigh52w: '365.21', marketCap: '64445706745', dividendYield: '0.5' },
    statusInfo: { marketStatus: 'premarket' },
  }
  const best = { t: { type: 3, symbol: 'MSTRB' }, dyn, ok: true, dev: 0.1 }
  const c = ui.stockCard({ ticker: 'MSTR', ref: 159.49, rows: [best], best }, { about: 'Strategy is a bitcoin treasury company. It also sells software.' })
  assert.match(c, /<b>\$159\.49<\/b>   ▼ 4\.24% today/)
  assert.match(c, /<i>Strategy is a bitcoin treasury company\.<\/i>/, 'first sentence only')
  assert.match(c, /<pre>Market cap  \$64\.4B\n52-week     \$81\.81 – \$365\.21\nDividend    0\.50% \/ yr\nUS market   Pre-market · token 24\/7<\/pre>/)
  const off = { t: { type: 1 }, dyn: { statusInfo: { marketStatus: 'offhours' } } }
  const quiet = { ...best, dyn: { ...dyn, statusInfo: { marketStatus: null } } } // bStocks: no status
  assert.match(ui.stockCard({ ticker: 'MSTR', ref: 1, rows: [quiet, off], best: quiet }), /US market   Closed/, 'status from whichever token has it')
  assert.ok(!ui.stockCard({ ticker: 'X', ref: 1, rows: [{ t: { type: 3 }, dyn: { stockInfo: { dividendYield: '0' } } }], best: undefined }).includes('Dividend'), 'no zero dividend line')
})
