// Integration: full Telegram flows (message → guard → buttons → swap → poll) against a fake
// Telegram API, the recorded RWA fixtures and a fake `baw`. No network, no funds.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { FIXTURE, FAKE_BAW, addr, quote, mockFetch, scenario } from '../agent/test/helpers.mjs'

const OWNER = 42
const sc = scenario({})
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const DATA = join(mkdtempSync(join(tmpdir(), 'yo-data-')), 'strategies.json')
Object.assign(process.env, { YO_DATA: DATA, BAW: FAKE_BAW, FAKE_BAW: sc.file, YO_POLL_MS: '1', TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_API: 'https://tg.test', YO_OWNER_CHAT_ID: String(OWNER) })
const { onMessage, onCallback, store, brand } = await import('./bot.mjs')
const { deps } = await import('./strategy.mjs')

let sent, restore, msgId
before(() => {
  restore = mockFetch(FIXTURE, {
    tg: (method, body) => {
      sent.push({ method, ...body })
      return method === 'sendMessage' ? { message_id: ++msgId } : true
    },
  })
})
after(() => restore())
beforeEach(() => { sent = []; msgId = 0 })

const ref = Number(FIXTURE.dynamic[addr('NVDAon')].data.stockInfo.price)
const mult = (s) => Number(FIXTURE.dynamic[addr(s)].data.tokenInfo.sharesMultiplier)
const fair = (s, usdt, pct = 0) => usdt / (ref * (1 + pct / 100) * mult(s))
const goodNvda = (usdt) => ({ [addr('NVDAon')]: quote(fair('NVDAon', usdt, 0.3)), [addr('NVDAB')]: quote(fair('NVDAB', usdt, 0.1)) })
const msg = (text, chat = OWNER) => ({ chat: { id: chat }, text })
const texts = () => sent.filter((s) => ['sendMessage', 'sendPhoto'].includes(s.method)).map((s) => s.text ?? s.caption)
const swaps = () => sc.calls().filter((c) => c[1] === 'swap')
const tap = (data, chat = OWNER) => onCallback({ id: 'cb', data, message: { chat: { id: chat }, message_id: 1 } })
const buttonData = () => sent.findLast((s) => s.reply_markup)?.reply_markup.inline_keyboard[0].map((b) => b.callback_data)

test('stranger: /buy, /sell and strategies are owner-only; wallet untouched', async () => {
  const n = sc.calls().length
  for (const t of ['/buy NVDA 10', '/sell NVDA', '/strategy buy NVDA daily', '/stop x']) await onMessage(msg(t, 7))
  assert.ok(texts().slice(0, 2).every((t) => /Connect Binance first/.test(t)))
  assert.ok(texts().slice(2).every((t) => /only the owner's wallet/.test(t)), 'strategies stay owner-only')
  assert.equal(sc.calls().length, n)
})

test('stranger (demo mode): /start shows demo help, /quote works on live data without buttons, then rate-limits', async (t) => {
  sc.set({ quotes: goodNvda(10) })
  const swapsBefore = swaps().length
  await onMessage(msg('/start', 8))
  assert.ok(sent[0].reply_markup.inline_keyboard.flat().some((b) => b.text === '🔗 Connect Binance to buy'), 'guests get a Connect button')
  await onMessage(msg('/quote NVDA 10', 8))
  assert.match(texts()[1], /⭐ <b>bStocks · NVDAB<\/b>/)
  assert.equal(sent[1].reply_markup, undefined, 'no trade buttons for strangers')
  assert.equal(swaps().length, swapsBefore)
  await onMessage(msg('/quote NVDA 10', 8))
  assert.match(texts()[2], /try again in a few seconds/)
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 11_000)
  await onMessage(msg('/quote NVDA 10', 8))
  assert.match(texts()[3], /⭐ <b>bStocks · NVDAB<\/b>/)
})

test('owner /start gets help; bad input gets usage', async () => {
  await onMessage(msg('/start'))
  await onMessage(msg('/buy NVDA 99999'))
  await onMessage(msg('/quote'))
  const t = texts()
  assert.match(t[0], /Buy US stocks with USDT[\s\S]*<b>NVIDIA<\/b> · \$\d+\.\d\d · (🟢 \+|🔴 −)\d+\.\d%[\s\S]*Tap one for details/, 'live price + 24h change from the fixture')
  assert.match(t[1], /usage: \/buy NVDA 10 \(1–1000 USDT\)/)
  assert.match(t[2], /usage: \/quote/)
})

test('/quote replies with the guarded table, no buttons, no swap', async () => {
  sc.set({ quotes: goodNvda(10) })
  const n = swaps().length
  await onMessage(msg('/quote nvda 10'))
  assert.match(texts()[0], /^<b>NVDA<\/b> · Nvidia Corp · quote for <b>10 USDT<\/b>\nReference price <b>\$\d+\.\d\d<\/b> \/ share/)
  assert.equal(sent[0].method, 'sendPhoto')
  assert.equal(sent[0].photo, 'https://yostocks.xyz/stocks/nvda.png', 'the stock\'s own logo')
  assert.match(texts()[0], /⭐ <b>bStocks · NVDAB<\/b>\n.*best route/)
  assert.match(texts()[0], /⛔ xStocks · NVDAx\n.*No liquidity/)
  assert.equal(sent[0].parse_mode, 'HTML')
  assert.equal(sent[0].reply_markup, undefined)
  assert.equal(swaps().length, n)
})

test('/buy → Confirm re-runs the guard, swaps the best token once, reports the fill', async () => {
  sc.set({ quotes: goodNvda(10), swap: { success: true, data: { orderId: 'o-7' } }, orderStatus: 'FINISHED', txHash: '0xfeed' })
  const n = swaps().length
  await onMessage(msg('/buy NVDA 10'))
  const [yes, no] = buttonData()
  assert.match(yes, /^buy:/)
  assert.match(no, /^no:/)
  assert.match(texts()[0], /You receive ≈ <b>[\d.]+ NVDAB<\/b>\n<i>Confirm within 60 seconds\.<\/i>/)
  assert.equal(sent[0].reply_markup.inline_keyboard[0][0].text, '✅ Swap 10 USDT → NVDAB')
  assert.equal(swaps().length, n, 'no swap before Confirm')

  const quotesBefore = sc.calls().filter((c) => c[1] === 'quote').length
  await tap(yes)
  assert.ok(sc.calls().filter((c) => c[1] === 'quote').length > quotesBefore, 'guard re-ran on Confirm')
  assert.equal(swaps().length, n + 1)
  const s = swaps().at(-1)
  assert.equal(s[s.indexOf('--toToken') + 1], addr('NVDAB'))
  assert.ok(sent.some((x) => x.method === 'editMessageReplyMarkup'), 'buttons removed')
  assert.match(texts().join('\n'), /⏳ Buying <b>\$10<\/b> of NVIDIA/)
  assert.match(texts().at(-1), /✅ <b>Done! You bought NVIDIA<\/b>[\s\S]*shares for <b>\$10\.00<\/b>[\s\S]*<a href="https:\/\/bscscan\.com\/tx\/0xfeed">See the transaction/)

  await tap(yes) // double tap
  assert.equal(swaps().length, n + 1, 'second tap must not trade again')
  assert.match(texts().at(-1), /expired\. Send \/buy again/)
})

test('Cancel never trades', async () => {
  sc.set({ quotes: goodNvda(10) })
  await onMessage(msg('/buy NVDA 10'))
  const n = swaps().length
  await tap(buttonData()[1])
  assert.equal(swaps().length, n)
  assert.match(texts().at(-1), /Cancelled\./)
})

test('Confirm older than 60s is refused', async (t) => {
  sc.set({ quotes: goodNvda(10) })
  await onMessage(msg('/buy NVDA 10'))
  const n = swaps().length
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 61_000)
  await tap(buttonData()[0])
  assert.equal(swaps().length, n)
  assert.match(texts().at(-1), /older than 60 seconds/)
})

test("a stranger can't press the owner's Confirm button", async () => {
  sc.set({ quotes: goodNvda(10) })
  await onMessage(msg('/buy NVDA 10'))
  const n = swaps().length
  await tap(buttonData()[0], 7)
  assert.equal(swaps().length, n)
})

test('quote turns unsafe between /buy and Confirm → no swap', async () => {
  sc.set({ quotes: goodNvda(10) })
  await onMessage(msg('/buy NVDA 10'))
  sc.set({ quotes: { [addr('NVDAon')]: quote(fair('NVDAon', 10, 4)), [addr('NVDAB')]: quote(0.00000001) } })
  const n = swaps().length
  await tap(buttonData()[0])
  assert.equal(swaps().length, n)
  assert.match(texts().at(-1), /No safe route right now/)
})

test('/buy with no safe route shows the table without buttons', async () => {
  sc.set({ quotes: { [addr('NVDAB')]: quote(0.00000001) } })
  await onMessage(msg('/buy NVDA 10'))
  assert.equal(buttonData(), undefined)
  assert.match(texts()[0], /No safe route right now/)
})

test('FAILED order surfaces as an error, not a fill', async () => {
  sc.set({ quotes: goodNvda(10), orderStatus: 'FAILED' })
  await onMessage(msg('/buy NVDA 10'))
  await assert.rejects(tap(buttonData()[0]), /FAILED/)
  assert.ok(!texts().some((t) => t.includes('Done! You bought')))
})

test('provider text is HTML-escaped inside <pre>', async () => {
  sc.set({ quotes: { [addr('NVDAB')]: { success: false, error: { message: '<b>bad</b> & worse' } } } })
  await onMessage(msg('/quote NVDA 10'))
  assert.match(texts()[0], /&lt;b&gt;bad&lt;\/b&gt; &amp; worse/)
})

test('/strategy → Save persists the rule; /strategies lists it; /stop removes it', async () => {
  const rule = { ticker: 'NVDA', usdt: 10, every: 'week', weekday: 'mon', hourUtc: 14, skipEarnings: true, maxPremiumPct: 0.5, unsupported: [] }
  deps.client = { responses: { parse: async () => ({ status: 'completed', output: [], output_parsed: rule }) } }
  await onMessage(msg('/strategy buy $10 of NVDA every Monday, skip earnings, max 0.5% premium'))
  assert.match(texts()[0], /🗓 <b>New strategy<\/b>[\s\S]*Buy 10 USDT of NVDA every Monday[\s\S]*• skip while earnings/)
  const [save] = buttonData()
  assert.match(save, /^save:/)
  assert.deepEqual(store.load(), [], 'nothing saved before the tap')
  await tap(save)
  const saved = store.load()
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0].rule, rule)
  assert.deepEqual(JSON.parse(readFileSync(DATA, 'utf8'))[0].rule, rule)
  await tap(save)
  assert.equal(store.load().length, 1, 'double tap saves once')

  await onMessage(msg('/strategies'))
  assert.match(texts().at(-1), new RegExp(`#${saved[0].id}`))
  await onMessage(msg(`/stop ${saved[0].id}`))
  assert.equal(store.load().length, 0)
  assert.match(texts().at(-1), /Stopped strategy/)
  await onMessage(msg('/stop nope'))
  assert.match(texts().at(-1), /No strategy #nope/)
})

test('/strategy with unsupported parts is refused with the reason, no Save button', async () => {
  deps.client = { responses: { parse: async () => ({ status: 'completed', output: [], output_parsed: { ticker: 'NVDA', usdt: 10, every: 'day', weekday: null, hourUtc: 14, skipEarnings: false, maxPremiumPct: null, unsupported: ['sell half if it drops 10%'] } }) } }
  await onMessage(msg('/strategy buy NVDA daily and sell half if it drops 10%'))
  assert.match(texts()[0], /Can't save this strategy[\s\S]*• not supported: sell half if it drops 10%/)
  assert.equal(buttonData(), undefined)
})

test("a stranger can't use /strategy", async () => {
  let called = false
  deps.client = { responses: { parse: async () => { called = true } } }
  await onMessage(msg('/strategy buy NVDA daily', 7))
  assert.equal(called, false)
})

test('with a logo, receipts and /start go out as a photo with the text as caption', async () => {
  brand.logo = 'LOGO_FILE_ID'
  try {
    await onMessage(msg('/start'))
    assert.equal(sent[0].method, 'sendPhoto')
    assert.equal(sent[0].photo, 'LOGO_FILE_ID')
    assert.equal(sent[0].parse_mode, 'HTML')
    assert.match(sent[0].caption, /Buy US stocks with USDT/)

    sc.set({ quotes: goodNvda(10), swap: { success: true, data: { orderId: 'o-8' } }, orderStatus: 'FINISHED', txHash: '0xbeef' })
    await onMessage(msg('/buy NVDA 10'))
    assert.equal(sent.at(-1).method, 'sendPhoto', 'quote card is the stock logo with buttons')
    assert.ok(sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data.startsWith('buy:'))
    await tap(buttonData()[0])
    const r = sent.at(-1)
    assert.equal(r.method, 'sendPhoto')
    assert.equal(r.photo, 'https://yostocks.xyz/stocks/nvda.png', 'receipt shows the stock bought')
    assert.match(r.caption, /✅ <b>Done! You bought NVIDIA<\/b>/)
    assert.ok(r.caption.length <= 1024, 'Telegram caption limit')
  } finally { brand.logo = null }
})

test('stock logo unavailable → falls back to the bot logo, then to plain text', async () => {
  const { stockMeta } = await import('./bot.mjs')
  const fx = structuredClone(FIXTURE)
  fx.meta = { [addr('METAB')]: { success: false }, [addr('METAon')]: { success: false } }
  restore(); restore = mockFetch(fx, { tg: (method, body) => { sent.push({ method, ...body }); return method === 'sendMessage' || method === 'sendPhoto' ? { message_id: ++msgId } : true } })
  try {
    assert.equal(await stockMeta({ contractAddress: addr('METAB') }), null)
    const metaFair = (s) => 10 / (Number(FIXTURE.dynamic[addr('METAon')].data.stockInfo.price) * Number(FIXTURE.dynamic[addr(s)].data.tokenInfo.sharesMultiplier))
    sc.set({ quotes: { [addr('METAB')]: quote(metaFair('METAB')) } })
    brand.logo = 'BOT_LOGO'
    await onMessage(msg('/quote META 10'))
    assert.equal(sent[0].photo, 'BOT_LOGO')
    brand.logo = null
    sent = []
    await onMessage(msg('/quote META 10'))
    assert.equal(sent[0].method, 'sendMessage')
  } finally { brand.logo = null; restore(); restore = mockFetch(FIXTURE, { tg: (method, body) => { sent.push({ method, ...body }); return method === 'sendMessage' || method === 'sendPhoto' ? { message_id: ++msgId } : true } }) }
})

// ---- /sell ----
const HELD = '0.022409841731513969'
const holding = (symbol, balance = HELD) => [{ symbol, address: addr(symbol), binanceChainId: '56', balance }]
const sellFair = (sym, qty, pct = 0) => Number(qty) * mult(sym) * ref * (1 + pct / 100)

test('/sell NVDA → card with Sell button → Confirm re-checks, swaps NVDAB → USDT once, sends a Sold receipt', async () => {
  const USDT = '0x55d398326f99059ff775485246999027b3197955'
  sc.set({ balances: holding('NVDAB'), sellQuotes: { [addr('NVDAB')]: quote(sellFair('NVDAB', HELD, 0.06)) },
    swap: { success: true, data: { orderId: 'bad' } }, idLookupBroken: true,
    recent: [{ orderId: 's-9', status: 'FINISHED', fromToken: addr('NVDAB'), fromTokenQty: HELD, toToken: USDT, toTokenActualQty: '4.98', txHash: '0x5e11' }] })
  const n = swaps().length
  await onMessage(msg('/sell NVDA'))
  assert.match(texts()[0], /<b>Sell NVIDIA\?<\/b>[\s\S]*shares → about/)
  const [yes, no] = buttonData()
  assert.match(yes, /^sell:/)
  assert.match(no, /^no:/)
  assert.equal(swaps().length, n, 'nothing sold before Confirm')
  await tap(yes)
  assert.equal(swaps().length, n + 1)
  const s = swaps().at(-1)
  assert.equal(s[s.indexOf('--fromToken') + 1], addr('NVDAB'))
  assert.equal(s[s.indexOf('--toToken') + 1].toLowerCase(), USDT)
  assert.equal(s[s.indexOf('--fromTokenQty') + 1], HELD)
  assert.match(texts().join('\n'), /⏳ Selling your NVIDIA/)
  assert.match(texts().at(-1), /✅ <b>Sold!<\/b> You got <b>\$4\.98<\/b>[\s\S]*bscscan\.com\/tx\/0x5e11/)
  await tap(yes)
  assert.equal(swaps().length, n + 1, 'double tap sells once')
})

test('/sell when Ondo is closed shows the reason and no Sell button', async () => {
  sc.set({ balances: holding('NVDAon', '0.01'), sellQuotes: { [addr('NVDAon')]: { success: false, error: { code: 316008, name: 'SERVICE_ERROR', message: 'Token NVDAon currently has no available liquidity. Please trade during stock market opening hours.' } } } })
  await onMessage(msg('/sell NVDA'))
  assert.match(texts()[0], /Can't sell NVIDIA right now[\s\S]*only be sold while the US stock market is open/)
  assert.ok(!(sent.findLast((x) => x.reply_markup)?.reply_markup.inline_keyboard.flat() ?? []).some((b) => b.text.startsWith('✅ Sell')), 'no Sell button')
})

test('/sell of something not held, and a stranger pressing Sell, never trade', async () => {
  sc.set({ balances: [] })
  await assert.rejects(onMessage(msg('/sell MSTR')), /you don't hold any MSTR token/)
  sc.set({ balances: holding('NVDAB'), sellQuotes: { [addr('NVDAB')]: quote(sellFair('NVDAB', HELD)) } })
  await onMessage(msg('/sell NVDA'))
  const n = swaps().length
  await tap(buttonData()[0], 7)
  assert.equal(swaps().length, n)
})
