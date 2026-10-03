// Integration: the button-first flow (home → stock card → Buy $X, My stocks → Sell) against fakes.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
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
  assert.match(c, /<b>NVIDIA<\/b> · NVDA\n<b>\$\d+\.\d\d<\/b>/)
  assert.match(c, /✅ <b>Fair price<\/b> · via bStocks, 0\.02% above the stock price/)
  assert.deepEqual(kb().map((b) => b.text), ['Buy $5', 'Buy $10', 'Buy $25', '✏️ Other', 'ℹ️ Details', '🏠 Home', '🎯 Buy if it drops', '🔁 Auto-invest', '🔔 Alert me'])
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
  assert.match(texts().at(-1), /· NVDA/)
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
  assert.match(texts().at(-1), /Disconnected[\s\S]*Auto-invest pauses[\s\S]*stay in your Binance wallet/)
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


test('a dropped connection to Telegram is retried; a failed button-spinner stop never aborts the action', async () => {
  const real = globalThis.fetch
  let drops = 0
  globalThis.fetch = (url, init) => {
    const m = String(url).split('/').pop()
    if (String(url).startsWith('https://tg.test') && (m === 'answerCallbackQuery' || (m === 'sendPhoto' && drops++ === 0))) return Promise.reject(new TypeError('fetch failed'))
    return real(url, init)
  }
  try {
    await tap('home')
  } finally {
    globalThis.fetch = real
  }
  assert.equal(drops, 2, 'first sendPhoto dropped, retry went through')
  assert.match(texts().at(-1), /Buy US stocks with USDT/)
})

test('✏️ Other: type an amount, confirm, the guard runs again and buys exactly that; bad input asks again', async () => {
  sc.set({ quotes: quotes(10) })
  await tap('stk:NVDA')
  await tap(button('✏️ Other'))
  assert.match(texts().at(-1), /How much USDT of <b>NVIDIA<\/b>/)
  assert.equal(sent.at(-1).reply_markup.force_reply, true)
  await onMessage({ chat: { id: OWNER }, text: '/start' }) // not a number: normal message, amount prompt dropped
  await tap('stk:NVDA')
  await tap(button('✏️ Other'))
  await onMessage({ chat: { id: OWNER }, text: '5000' })
  assert.match(texts().at(-1), /from 1 to 1000/)
  sc.set({ quotes: quotes(15) })
  await onMessage({ chat: { id: OWNER }, text: '$15' })
  assert.match(texts().at(-1), /Buy <b>\$15<\/b> of <b>NVIDIA<\/b>\?/)
  const confirm = button('✅ Buy $15')
  const n = swaps().length
  await tap(confirm.replace(/:15$/, ':25')) // forged amount on the same offer
  assert.equal(swaps().length, n, 'only the typed amount')
  sc.set({ quotes: quotes(10) }) // the card checks at $10
  await tap('stk:NVDA') // the forged tap used up that offer; start again
  await tap(button('✏️ Other'))
  await onMessage({ chat: { id: OWNER }, text: '15' })
  sc.set({ quotes: quotes(15) })
  await tap(button('✅ Buy $15'))
  assert.match(texts().at(-1), /Done! You bought/)
  assert.equal(arg(swaps().at(-1), '--fromTokenQty'), '15')
})

test('owner: Disconnect signs the server wallet out (dir kept), then Connect from Telegram; an expired session asks to connect', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yo-owner-baw-'))
  writeFileSync(join(dir, 'session.json'), '{}')
  process.env.BINANCE_BAW_DIR = dir
  try {
    sc.set({ quotes: quotes(10) })
    await onMessage({ chat: { id: OWNER }, text: '/start' })
    await tap(button('🔌 Disconnect'))
    assert.match(texts().at(-1), /Disconnected/)
    assert.deepEqual(sc.calls().at(-1).slice(0, 2), ['auth', 'signout'])
    assert.ok(existsSync(join(dir, 'session.json')), "the owner's session dir is never deleted")
    await tap('stk:NVDA')
    assert.ok(!kb().some((b) => b.text.startsWith('Buy')), 'signed out: no Buy')
    await tap(button('🔗 Connect Binance to buy'))
    assert.ok(texts().some((t) => /Connected!/.test(t)))
    assert.ok(kb().some((b) => b.text === 'Buy $10'), 'back on the stock with Buy')
    sc.set({ quotes: quotes(10), auth: 'SESSION_EXPIRED' })
    await tap('pf')
    assert.match(texts().at(-1), /connect Binance again/)
    assert.ok(kb().some((b) => b.text === '🔗 Connect Binance to buy'))
  } finally {
    delete process.env.BINANCE_BAW_DIR
    sc.set({ quotes: quotes(10) })
    await tap('cw') // leave the owner connected for other tests
  }
})

test('no wallet session to quote with: a guest still sees the stock card and Connect, never a baw command', async () => {
  sc.set({ auth: 'SESSION_EXPIRED' })
  await tap('stk:META', 91)
  const c = texts().at(-1)
  assert.match(c, /<b>Meta<\/b> · META\n<b>\$\d+\.\d\d<\/b>/)
  assert.ok(!/baw|Fair price|Buying paused/.test(c), 'no verdict without quotes')
  assert.ok(kb().some((b) => b.text === '🔗 Connect Binance to buy'))
  await tap('why:META', 92)
  assert.match(texts().at(-1), /Connect Binance first/)
  sc.set({})
})

test('limit prices are guarded: a buy trigger at or above the real price is refused (it would just buy now)', async () => {
  const { checkTrigger } = await import('../agent/orders.mjs')
  assert.match(checkTrigger('buy', 230, 224), /buy now instead/)
  assert.match(checkTrigger('buy', 100, 224), /50% below/)
  assert.match(checkTrigger('sell', 220, 224), /at or below/)
  assert.match(checkTrigger('sell', 500, 224), /double/)
  assert.equal(checkTrigger('buy', 213, 224), null)
  assert.equal(checkTrigger('sell', 246, 224), null)
})

test('🔁 Auto-invest: $10 every Monday from the stock card, saved for this chat, listed, stopped', async () => {
  const { store } = await import('./bot.mjs')
  sc.set({ quotes: quotes(10) })
  await tap('stk:NVDA')
  await tap(button('🔁 Auto-invest'))
  assert.match(texts().at(-1), /Auto-invest in NVIDIA[\s\S]*at most \$50 a day/)
  await tap(button('$10'))
  await tap(button('Every Monday'))
  assert.match(texts().at(-1), /Buy \$10 of NVIDIA every Monday at 21:00 WIB\?/)
  await tap(button('✅ Start'))
  assert.match(texts().at(-1), /Auto-invest on[\s\S]*First buy: <b>Mon \d{1,2} \w{3}, 21:00 WIB<\/b>/)
  const s = store.load().at(-1)
  assert.equal(s.chat, OWNER)
  assert.deepEqual([s.rule.ticker, s.rule.usdt, s.rule.every, s.rule.weekday, s.rule.hourUtc], ['NVDA', 10, 'week', 'mon', 14])
  await tap('ail')
  assert.match(texts().at(-1), /1\. Buy \$10 of NVIDIA every Monday/)
  await tap(button('⏹ Stop 1'))
  assert.match(texts().at(-1), /Stopped/)
  assert.ok(!store.load().some((x) => x.id === s.id))
})

test('🔔 price alerts: a guest (no wallet) sets ±5% on NVIDIA; it fires once when the price has moved, then is gone; max 5', async () => {
  const { alertStore, watchAlerts } = await import('./bot.mjs')
  const G = 93
  sc.set({ quotes: quotes(10) })
  await tap('stk:NVDA', G)
  await tap(button('🔔 Alert me'), G)
  assert.match(texts().at(-1), /Tell me when NVIDIA moves/)
  await tap(button('±5%'), G)
  assert.match(texts().at(-1), /Alert on\.<\/b> I'll message you if NVIDIA moves 5% from \$[\d.]+: up to \$[\d.]+ or down to \$[\d.]+/)
  const a = alertStore.load().find((x) => x.chat === G)
  assert.equal(a.ticker, 'NVDA')

  await watchAlerts() // price unchanged: nothing
  assert.ok(alertStore.load().some((x) => x.id === a.id))
  alertStore.save(alertStore.load().map((x) => (x.id === a.id ? { ...x, ref: x.ref / 1.08 } : x))) // as if set 8% lower
  const n = texts().length
  await watchAlerts()
  assert.match(texts().at(-1), /NVIDIA is up 8\.0%/)
  assert.ok(kb().some((b) => b.text === 'Open NVIDIA'))
  assert.ok(!alertStore.load().some((x) => x.id === a.id), 'one-shot')
  await watchAlerts()
  assert.equal(texts().length, n + 1, 'fired once')

  for (let i = 0; i < 5; i++) await tap('alp:NVDA:3', G)
  await tap('alp:NVDA:3', G)
  assert.match(texts().at(-1), /already have 5 alerts/)
  await tap('all', G)
  assert.match(texts().at(-1), /5\. NVIDIA moves 3%/)
  await tap(button('✖ Remove 1'), G)
  assert.equal(alertStore.load().filter((x) => x.chat === G).length, 4)
})

test('🎯 Buy if it drops is kept by the agent (baw limit orders refuse stock tokens): set −5% $10, nothing on-chain; fills through the guard once the price is there, message once', async () => {
  const { orderStore, watchOrders } = await import('./bot.mjs')
  sc.set({ quotes: quotes(10), txHash: '0xabc123' })
  await tap('stk:NVDA')
  await tap(button('🎯 Buy if it drops'))
  assert.match(texts().at(-1), /I watch it every minute/)
  const five = kb().find((b) => b.text.startsWith('−5%'))
  const price = +(ref * 0.95).toFixed(2)
  assert.equal(five.text, `−5% · $${price.toFixed(2)}`)
  await tap(five.callback_data)
  await tap(button('$10'))
  let n = sc.calls().length
  await tap(button('✅ Place order'))
  assert.ok(!sc.calls().slice(n).some((c) => c[0] === 'limit-order' || c[1] === 'swap'), 'nothing sent to the chain yet')
  assert.match(texts().at(-1), /Order set[\s\S]*Nothing is bought yet[\s\S]*every minute/)
  const o = orderStore.load().at(-1)
  assert.deepEqual([o.side, o.ticker, o.usdt, o.price, o.status], ['buy', 'NVDA', 10, price, 'WORKING'])
  await tap('ord')
  assert.match(texts().at(-1), /Buy \$10 of NVIDIA at \$[\d.]+ · <i>waiting<\/i>/)

  n = swaps().length
  await watchOrders() // real price still above the target
  assert.equal(swaps().length, n)
  orderStore.save(orderStore.load().map((x) => (x.strategyId === o.strategyId ? { ...x, price: +(ref * 1.01).toFixed(2) } : x))) // as if the price dropped to it
  await watchOrders()
  assert.equal(swaps().length, n + 1, 'bought once, through the same swap path as Buy')
  assert.equal(arg(swaps().at(-1), '--fromTokenQty'), '10')
  assert.match(texts().at(-1), /Your order filled![\s\S]*bscscan\.com\/tx\/0xabc123/)
  const t = texts().length
  await watchOrders()
  assert.equal(texts().length, t, 'told once')
  assert.equal(orderStore.load().find((x) => x.strategyId === o.strategyId).status, 'FINISHED')
})

test('🎯 Sell higher: set +10%, cancel locally; a second one sells all when the price gets there', async () => {
  const { orderStore, watchOrders } = await import('./bot.mjs')
  const HELD = '0.0224'
  const bal = [{ symbol: 'NVDAB', address: addr('NVDAB'), balance: HELD, value: '5.02' }, { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', balance: '100', value: '100' }]
  sc.set({ balances: bal, sellQuotes: { [addr('NVDAB')]: quote(Number(HELD) * mult('NVDAB') * ref) } })
  await tap('pf')
  await tap(button('🎯 Sell higher'))
  await tap(kb().find((b) => b.text.startsWith('+10%')).callback_data)
  await tap(button('✅ Place order'))
  assert.match(texts().at(-1), /Order set[\s\S]*Nothing is sold yet/)
  await tap('ord')
  const n = sc.calls().length
  await tap(button('✖ Cancel 1'))
  assert.match(texts().at(-1), /Order canceled/)
  assert.equal(sc.calls().length, n, 'nothing on-chain to cancel')

  await tap('tp:NVDA')
  await tap(kb().find((b) => b.text.startsWith('+5%')).callback_data)
  await tap(button('✅ Place order'))
  const o = orderStore.load().at(-1)
  orderStore.save(orderStore.load().map((x) => (x.strategyId === o.strategyId ? { ...x, price: +(ref * 0.99).toFixed(2) } : x))) // as if the price rose to it
  const s0 = swaps().length
  await watchOrders()
  assert.equal(swaps().length, s0 + 1)
  assert.equal(arg(swaps().at(-1), '--fromToken'), addr('NVDAB'))
  assert.match(texts().at(-1), /Your order filled!<\/b> Sell NVIDIA/)
  assert.ok(!/tx\/null/.test(texts().at(-1)), 'no tx hash → no link')
})

test('orders: refused before setting when USDT is short or the stock is not held; bad ticker; 30 days without the price → expired', async () => {
  const { orderStore, watchOrders } = await import('./bot.mjs')
  sc.set({ quotes: quotes(10), balances: [{ symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', balance: '3', value: '3' }] })
  await tap('stk:NVDA')
  await tap(button('🎯 Buy if it drops'))
  await tap(kb().find((b) => b.text.startsWith('−5%')).callback_data)
  await tap(button('$10'))
  const count = orderStore.load().length
  await tap(button('✅ Place order'))
  assert.match(texts().at(-1), /Not enough USDT/)
  assert.equal(orderStore.load().length, count, 'nothing set')

  sc.set({ quotes: quotes(10), balances: [] })
  await tap('tp:NVDA')
  await tap(kb().find((b) => b.text.startsWith('+10%')).callback_data)
  await tap(button('✅ Place order'))
  assert.match(texts().at(-1), /Order not placed\.<\/b> you don't hold any NVDA yet/)

  await tap('tp:BAD1')
  assert.match(texts().at(-1), /expired/)

  orderStore.save([...orderStore.load(), { strategyId: 'old-1', chat: OWNER, side: 'buy', ticker: 'NVDA', usdt: 5, price: 1, status: 'WORKING', at: '2026-01-01T00:00:00Z' }])
  await watchOrders()
  assert.match(texts().at(-1), /Order expired/)
  assert.equal(orderStore.load().find((x) => x.strategyId === 'old-1').status, 'EXPIRED')
})

test('🛡 Safety: daily limit and what is left, risky-trade handling, approvals removable', async () => {
  const appr = [{ tokenSymbol: 'USDT', tokenContract: '0x55d398326f99059fF775485246999027B3197955', spender: '0x1111111254eeb25477b68fb85ed929f73a960582', spenderName: 'PancakeSwap', type: 'approve', binanceChainId: '56' },
    { tokenSymbol: 'ETH', tokenContract: '0x2', spender: '0x3', type: 'approve', binanceChainId: '1' }]
  sc.set({ approvals: appr })
  await tap('sf')
  const c = texts().at(-1)
  assert.match(c, /Daily limit\s+\$500\.00 \(\$490\.00 left today\)/)
  assert.match(c, /Risky trades\s+Blocked automatically/)
  assert.match(c, /Approvals\s+1\n/, 'BSC only')
  await tap(button('🧹 Remove 1 approval'))
  assert.match(texts().at(-1), /USDT → PancakeSwap/)
  await tap(button('🧹 Remove'))
  assert.ok(sc.calls().some((c) => c[0] === 'approvals' && c[1] === 'revoke' && arg(c, '--type') === 'approve'))
  assert.match(texts().at(-1), /Submitted\.<\/b> 1 of 1/)
})

test('session keepalive: a wallet read every 6 h; one reminder a day before the 7-day sign-in ends; 🔄 Renew signs out and back in', async () => {
  const { keepAlive } = await import('./bot.mjs')
  const t0 = Date.parse('2030-01-01T00:00:00Z')
  const end = new Date(t0 + 12 * 36e5).toISOString()
  sc.set({ settings: { success: true, data: { dailyLimit: 500, quotaLeft: 500, signInMaxTime: end } } })
  const reads = () => sc.calls().filter((c) => c[0] === 'wallet' && c[1] === 'settings' && c.at(-1) !== '@557').length
  let n = reads()
  await keepAlive(t0)
  assert.ok(reads() > n, 'read the wallet')
  assert.match(texts().at(-1), /Your Binance connection ends 2030-01-01 12:00 UTC/)
  assert.ok(kb().some((b) => b.text === '🔄 Renew'))
  const msgs = texts().length
  n = reads()
  await keepAlive(t0 + 36e5)
  assert.equal(reads(), n, 'not again within 6 h')
  await keepAlive(t0 + 7 * 36e5)
  assert.equal(texts().length, msgs, 'reminded once per sign-in')

  sc.set({ quotes: quotes(10) })
  const c0 = sc.calls().length
  await tap('rw')
  const after = sc.calls().slice(c0).filter((c) => c[0] === 'auth').map((c) => c[1])
  assert.deepEqual(after.slice(0, 2), ['signout', 'signin'], 'renew = sign out, then the QR sign-in')
})
