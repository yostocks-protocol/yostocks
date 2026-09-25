// Integration: the button-first flow (home → stock card → Buy $X, My stocks → Sell) against fakes.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FIXTURE, FAKE_BAW, addr, quote, mockFetch, scenario } from '../agent/test/helpers.mjs'

const OWNER = 42
const sc = scenario({})
Object.assign(process.env, { YO_DATA: join(mkdtempSync(join(tmpdir(), 'yo-h-')), 's.json'), BAW: FAKE_BAW, FAKE_BAW: sc.file, YO_POLL_MS: '1', TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_API: 'https://tg.test', YO_OWNER_CHAT_ID: String(OWNER) })
const { onMessage, onCallback } = await import('./bot.mjs')

let sent, restore, msgId
before(() => { restore = mockFetch(FIXTURE, { tg: (method, body) => { sent.push({ method, ...body }); return ['sendMessage', 'sendPhoto'].includes(method) ? { message_id: ++msgId } : true } }) })
after(() => restore())
beforeEach(() => { sent = []; msgId = 0 })

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
  await tap('pf')
  assert.match(texts().at(-1), /💼 <b>Your stocks<\/b> · \$5\.02[\s\S]*<b>NVIDIA<\/b> · 0\.0224 shares · \$5\.02/)
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
  assert.match(texts().at(-1), /One price check every 10 seconds/)
  await tap('pf', 77)
  await tap('sl:NVDA', 77)
  assert.ok(texts().slice(-2).every((t) => /only the owner's wallet/.test(t)))
  await onMessage({ chat: { id: 78 }, text: 'nvda' })
  assert.ok(!kb().some((b) => b.text.startsWith('Buy')))
  assert.equal(swaps().length, n)
})
