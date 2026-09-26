// Integration: the button-first flow (home → stock card → Buy $X, My stocks → Sell) against fakes.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FIXTURE, FAKE_BAW, addr, quote, mockFetch, scenario } from '../agent/test/helpers.mjs'

const OWNER = 42
const sc = scenario({})
Object.assign(process.env, { YO_DATA: join(mkdtempSync(join(tmpdir(), 'yo-h-')), 's.json'), BAW: FAKE_BAW, FAKE_BAW: sc.file, YO_POLL_MS: '1', TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_API: 'https://tg.test', YO_OWNER_CHAT_ID: String(OWNER), YO_QUICKCHART: 'https://chart.test' })
const { onMessage, onCallback } = await import('./bot.mjs')

const BOUGHT = Date.parse('2026-09-24T12:48:08Z')
const kline = { [addr('NVDAB').toLowerCase()]: { success: true, data: { klineInfos: [0, 1, 2, 3].map((i) => [BOUGHT + i * 36e5, '0', '0', '0', String(220 + i), '0', 0]) } } }
let sent, restore, msgId, charts
before(() => { restore = mockFetch({ ...FIXTURE, kline }, { other: async (u, init) => { charts.push(JSON.parse(init.body)); return Response.json({ success: true, url: 'https://chart.test/pnl.png' }) }, tg: (method, body) => { sent.push({ method, ...body }); return ['sendMessage', 'sendPhoto'].includes(method) ? { message_id: ++msgId } : true } }) })
after(() => restore())
beforeEach(() => { sent = []; msgId = 0; charts = [] })

const ref = Number(FIXTURE.dynamic[addr('NVDAon')].data.stockInfo.price)
const mult = (s) => Number(FIXTURE.dynamic[addr(s)].data.tokenInfo.sharesMultiplier)
const fair = (s, usdt, pct = 0) => usdt / (ref * (1 + pct / 100) * mult(s))
const quotes = (usdt) => ({ [addr('NVDAon')]: quote(fair('NVDAon', usdt, 0.3)), [addr('NVDAB')]: quote(fair('NVDAB', usdt, 0.02)) })
const texts = () => sent.filter((s) => ['sendMessage', 'sendPhoto'].includes(s.method)).map((s) => s.text ?? s.caption)
const kb = (i = -1) => sent.filter((s) => s.reply_markup).at(i)?.reply_markup.inline_keyboard.flat() ?? []
const button = (label) => kb().find((b) => b.text === label)?.callback_data
const tap = (data, chat = OWNER) => onCallback({ id: 'cb', data, message: { chat: { id: chat }, message_id: 1 } })
const swaps = () => sc.calls().filter((c) => c[1] === 'swap')
const arg = (c, k) => c[c.indexOf(k) + 1]

test('owner /start: short pitch + ticker buttons + My stocks', async () => {
  await onMessage({ chat: { id: OWNER }, text: '/start' })
  assert.match(texts()[0], /Buy US stocks with USDT/)
  assert.equal(sent[0].photo, 'https://chart.test/pnl.png', 'the picture is the rendered price board')
  assert.match(charts[0].chart, /US stocks · 24h change/)
  assert.match(charts[0].chart, /"NVIDIA   \$\d+\.\d\d"/, 'name and price as the bar label')
  assert.ok(!/\$\d/.test(sent[0].caption), 'no price list in the caption')
  const labels = kb().map((b) => b.text)
  for (const t of ['NVIDIA', 'Tesla', 'Apple', 'Strategy', '💼 My stocks']) assert.ok(labels.includes(t), t)
})

test('tap NVDA → one-line best route, others summarised, Buy $5/$10/$25; nothing traded', async () => {
  sc.set({ quotes: quotes(10) })
  const n = swaps().length
  await tap('stk:NVDA')
  const c = texts().at(-1)
  assert.match(c, /<b>NVIDIA<\/b> \(NVDA\)\n<b>\$\d+\.\d\d<\/b> per share/)
  assert.match(c, /✅ <b>Good price right now<\/b>\n<i>Cheapest safe option: bStocks, 0\.02% above the stock price\.<\/i>/)
  assert.deepEqual(kb().map((b) => b.text), ['Buy $5', 'Buy $10', 'Buy $25', 'ℹ️ Why?', '🏠 Home'])
  assert.equal(swaps().length, n)
})

test('Buy $10 re-checks at 10 USDT, swaps exactly 10 into the best token once, sends the receipt', async () => {
  sc.set({ quotes: quotes(10) })
  await tap('stk:NVDA')
  const buy10 = button('Buy $10')
  sc.set({ quotes: quotes(10), swap: { success: true, data: { orderId: 'o-h' } }, orderStatus: 'FINISHED', txHash: '0xh0me' })
  const n = swaps().length
  await tap(buy10)
  assert.equal(swaps().length, n + 1)
  const s = swaps().at(-1)
  assert.equal(arg(s, '--fromTokenQty'), '10')
  assert.equal(arg(s, '--toToken'), addr('NVDAB'))
  assert.match(texts().at(-1), /✅ <b>Done! You bought NVIDIA<\/b>[\s\S]*shares for <b>\$10\.00<\/b>[\s\S]*0xh0me/)
  await tap(buy10)
  assert.equal(swaps().length, n + 1, 'one card, one buy')
})

test('typing a ticker opens its card; stale or forged Buy buttons never trade', async (t) => {
  sc.set({ quotes: quotes(10) })
  await onMessage({ chat: { id: OWNER }, text: 'nvda' })
  assert.match(texts().at(-1), /\(NVDA\)/)
  const buy5 = button('Buy $5')
  const n = swaps().length
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 61_000)
  await tap(buy5)
  assert.match(texts().at(-1), /older than 60 seconds/)
  t.mock.restoreAll()
  await tap('stk:NVDA')
  const forged = button('Buy $5').replace(/:5$/, ':999')
  await tap(forged)
  assert.equal(swaps().length, n)
})

test('💼 My stocks lists holdings with value and a Sell button that opens the guarded sell card', async () => {
  const HELD = '0.022409841731513969'
  sc.set({ balances: [{ symbol: 'NVDAB', address: addr('NVDAB'), balance: HELD, value: '5.02' }, { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', balance: '4', value: '4' }],
    sellQuotes: { [addr('NVDAB')]: quote(Number(HELD) * mult('NVDAB') * ref) } })
  sc.set({ ...JSON.parse(readFileSync(sc.file, 'utf8')), recent: [{ bookTime: '2026-09-24T12:48:08Z', fromToken: '0x55d398326f99059fF775485246999027B3197955', fromTokenQty: '5', toToken: addr('NVDAB'), toTokenActualQty: HELD }] })
  await tap('pf')
  assert.match(texts().at(-1), /💼 <b>Your stocks<\/b> · \$5\.02\n📈 \+\$0\.02 \(\+0\.4%\) since you bought[\s\S]*<b>NVIDIA<\/b> · 0\.0224 shares · \$5\.02 · 📈 \+\$0\.02/)
  const photo = sent.findLast((s) => s.method === 'sendPhoto')
  assert.equal(photo.photo, 'https://chart.test/pnl.png', 'PnL chart is the picture')
  assert.equal(charts[0].chart.data.datasets[0].data.length, 4, 'one point per hourly candle since the first buy')
  assert.ok(!texts().at(-1).includes('USDT'), 'stablecoins are not stocks')
  await tap(button('Sell NVIDIA'))
  assert.match(texts().at(-1), /Sell NVIDIA\?/)
  assert.match(kb()[0].text, /^✅ Sell for ~\$\d+\.\d\d$/)
})

test('empty wallet: My stocks says so and offers the ticker menu', async () => {
  sc.set({ balances: [] })
  await tap('pf')
  assert.match(texts().at(-1), /don't own any stocks yet/)
  assert.ok(kb().some((b) => b.text === 'NVIDIA'))
})

test('stranger: home without My stocks, stock card without Buy, portfolio/sell blocked, rate-limited', async () => {
  sc.set({ quotes: quotes(10) })
  await onMessage({ chat: { id: 77 }, text: '/start' })
  assert.ok(!kb().some((b) => b.text === '💼 My stocks'))
  await tap('stk:META', 77) // first card for this chat
  const n = swaps().length
  await tap('stk:NVDA', 77)
  assert.match(texts().at(-1), /try again in a few seconds/)
  await tap('pf', 77)
  await tap('sl:NVDA', 77)
  assert.ok(texts().slice(-2).every((t) => /Connect Binance first/.test(t)))
  await onMessage({ chat: { id: 78 }, text: 'nvda' })
  assert.ok(!kb().some((b) => b.text.startsWith('Buy')))
  assert.equal(swaps().length, n)
})

test('any user: tap a stock → Connect Binance → approve → back on that stock with Buy; trades run on their own wallet', async () => {
  const U = 555
  const dir = `@${U}`
  sc.set({ quotes: quotes(10), address: '0xUserWallet', wallets: {} })
  await onMessage({ chat: { id: U }, text: '/start' })
  assert.ok(!kb().some((b) => b.text === '💼 My stocks'))
  await tap('stk:NVDA', U)
  assert.ok(!kb().some((b) => b.text.startsWith('Buy')), 'no Buy before connecting')
  await tap(button('🔗 Connect Binance to buy'), U)
  const qr = sent.find((s) => s.method === 'sendPhoto' && /Connect Binance/.test(s.caption))
  assert.match(qr.caption, /<b>123456<\/b>/, 'pairing code shown')
  assert.match(qr.photo, /^https:\/\/chart\.test\/qr\?.*uni-qr/, 'QR of the sign-in link')
  assert.equal(qr.reply_markup.inline_keyboard[0][0].url, 'https://app.binance.com/uni-qr/test')
  assert.ok(texts().some((t) => /Connected!<\/b> You have \$1000\.00 to spend/.test(t)))
  assert.match(texts().at(-1), /NVIDIA/, 'back on the stock they wanted')
  const mine = () => sc.calls().filter((c) => c.at(-1) === dir)
  assert.deepEqual(new Set(mine().slice(0, 4).map((c) => c.slice(0, 2).join(' '))), new Set(['auth signin', 'auth verify', 'wallet address', 'wallet balance']), 'sign-in ran in the user dir')

  // Buy on the user's wallet, not the owner's.
  await tap(button('Buy $10'), U)
  assert.match(texts().at(-1), /Done! You bought/)
  assert.equal(swaps().at(-1).at(-1), dir, 'swap signed by the user session')

  // The owner's offers are not the user's to take, and vice versa.
  await tap('stk:NVDA')
  const ownerBuy = button('Buy $5')
  const n = swaps().length
  await tap(ownerBuy, U)
  assert.match(texts().at(-1), /expired/)
  assert.equal(swaps().length, n)

  await tap('home', U)
  await tap(button('🔌 Disconnect'), U)
  assert.match(texts().at(-1), /Disconnected/)
  assert.equal(mine().at(-1).slice(0, 2).join(' '), 'auth signout')
  await tap('pf', U)
  assert.match(texts().at(-1), /Connect Binance first/)
})

test('connect: an expired or rejected code leaves the user unconnected', async () => {
  const U = 556
  sc.set({ verify: { success: false, error: { code: 10002004, name: 'AUTH_REJECTED', message: 'QR code does not exist or expired' } } })
  await tap('cw', U)
  assert.match(texts().at(-1), /Not connected/)
  await tap('pf', U)
  assert.match(texts().at(-1), /Connect Binance first/)
})

test('connect is refused in groups: every member could use the wallet', async () => {
  const n = sc.calls().length
  await tap('cw', -1001234)
  assert.match(texts().at(-1), /private chat/)
  assert.equal(sc.calls().length, n, 'no sign-in started')
})

test('a connected user whose session died is unlinked and asked to reconnect, not told to run baw', async () => {
  const U = 557
  sc.set({ quotes: quotes(10) })
  await tap('cw', U)
  assert.match(texts().at(-1), /Connected!/)
  sc.set({ quotes: quotes(10), wallets: {}, auth: 'SESSION_EXPIRED' })
  await tap('pf', U)
  assert.match(texts().at(-1), /connect Binance again/)
  assert.ok(!texts().at(-1).includes('baw'))
  assert.ok(kb().some((b) => b.text === '🔗 Connect Binance to buy'))
  sc.set({ quotes: quotes(10) })
  await tap('pf', U)
  assert.match(texts().at(-1), /Connect Binance first/, 'unlinked')
})

test('empty wallet after connecting: where to send USDT; Buy without enough USDT says so and trades nothing', async () => {
  const U = 558
  sc.set({ quotes: quotes(10), address: '0xUserWallet', balances: [] })
  await tap('cw', U)
  assert.match(texts().at(-1), /Now add USDT[\s\S]*BNB Smart Chain[\s\S]*<code>0xUserWallet<\/code>/)
  sc.set({ quotes: quotes(10), address: '0xUserWallet', balances: [{ symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', balance: '3', value: '3' }] })
  await onMessage({ chat: { id: U }, text: 'nvda' })
  const n = swaps().length
  await tap(button('Buy $5'), U)
  assert.match(texts().at(-1), /Not enough USDT\.<\/b> You have \$3\.00, this needs \$5\.00[\s\S]*0xUserWallet/)
  assert.equal(swaps().length, n)
})

