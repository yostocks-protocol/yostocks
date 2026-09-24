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
const { onMessage, onCallback, store } = await import('./bot.mjs')
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
const texts = () => sent.filter((s) => s.method === 'sendMessage').map((s) => s.text)
const swaps = () => sc.calls().filter((c) => c[1] === 'swap')
const tap = (data, chat = OWNER) => onCallback({ id: 'cb', data, message: { chat: { id: chat }, message_id: 1 } })
const buttonData = () => sent.find((s) => s.reply_markup)?.reply_markup.inline_keyboard[0].map((b) => b.callback_data)

test('stranger gets their chat id and nothing else; wallet untouched', async () => {
  const n = sc.calls().length
  await onMessage(msg('/buy NVDA 10', 7))
  assert.match(texts()[0], /yostocks is private\. Your chat id: 7/)
  assert.equal(sc.calls().length, n)
})

test('owner /start gets help; bad input gets usage', async () => {
  await onMessage(msg('/start'))
  await onMessage(msg('/buy NVDA 99999'))
  await onMessage(msg('/quote'))
  const t = texts()
  assert.match(t[0], /\/quote NVDA 10/)
  assert.match(t[1], /usage: \/buy NVDA 10 \(1–1000 USDT\)/)
  assert.match(t[2], /usage: \/quote/)
})

test('/quote replies with the guarded table, no buttons, no swap', async () => {
  sc.set({ quotes: goodNvda(10) })
  const n = swaps().length
  await onMessage(msg('/quote nvda 10'))
  assert.match(texts()[0], /^<pre>NVDA · 10 USDT · reference/)
  assert.match(texts()[0], /★ bStocks +NVDAB/)
  assert.match(texts()[0], /✗ xStocks +NVDAx +No liquidity/)
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
  assert.match(texts()[0], /swap 10 USDT → NVDAB\?/)
  assert.equal(swaps().length, n, 'no swap before Confirm')

  const quotesBefore = sc.calls().filter((c) => c[1] === 'quote').length
  await tap(yes)
  assert.ok(sc.calls().filter((c) => c[1] === 'quote').length > quotesBefore, 'guard re-ran on Confirm')
  assert.equal(swaps().length, n + 1)
  const s = swaps().at(-1)
  assert.equal(s[s.indexOf('--toToken') + 1], addr('NVDAB'))
  assert.ok(sent.some((x) => x.method === 'editMessageReplyMarkup'), 'buttons removed')
  assert.match(texts().join('\n'), /submitted NVDAB order o-7/)
  assert.match(texts().at(-1), /✓ filled NVDAB\nhttps:\/\/bscscan\.com\/tx\/0xfeed/)

  await tap(yes) // double tap
  assert.equal(swaps().length, n + 1, 'second tap must not trade again')
  assert.match(texts().at(-1), /expired, send \/buy again/)
})

test('Cancel never trades', async () => {
  sc.set({ quotes: goodNvda(10) })
  await onMessage(msg('/buy NVDA 10'))
  const n = swaps().length
  await tap(buttonData()[1])
  assert.equal(swaps().length, n)
  assert.match(texts().at(-1), /cancelled/)
})

test('Confirm older than 60s is refused', async (t) => {
  sc.set({ quotes: goodNvda(10) })
  await onMessage(msg('/buy NVDA 10'))
  const n = swaps().length
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 61_000)
  await tap(buttonData()[0])
  assert.equal(swaps().length, n)
  assert.match(texts().at(-1), /older than 60s/)
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
  assert.match(texts().at(-1), /no safe route, not trading/)
})

test('/buy with no safe route shows the table without buttons', async () => {
  sc.set({ quotes: { [addr('NVDAB')]: quote(0.00000001) } })
  await onMessage(msg('/buy NVDA 10'))
  assert.equal(buttonData(), undefined)
  assert.match(texts()[0], /no safe route, not trading/)
})

test('FAILED order surfaces as an error, not a fill', async () => {
  sc.set({ quotes: goodNvda(10), orderStatus: 'FAILED' })
  await onMessage(msg('/buy NVDA 10'))
  await assert.rejects(tap(buttonData()[0]), /FAILED/)
  assert.ok(!texts().some((t) => t.includes('✓ filled')))
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
  assert.match(texts()[0], /Buy 10 USDT of NVDA every Monday[\s\S]*save this strategy\?/)
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
  assert.match(texts().at(-1), /stopped/)
  await onMessage(msg('/stop nope'))
  assert.match(texts().at(-1), /no strategy #nope/)
})

test('/strategy with unsupported parts is refused with the reason, no Save button', async () => {
  deps.client = { responses: { parse: async () => ({ status: 'completed', output: [], output_parsed: { ticker: 'NVDA', usdt: 10, every: 'day', weekday: null, hourUtc: 14, skipEarnings: false, maxPremiumPct: null, unsupported: ['sell half if it drops 10%'] } }) } }
  await onMessage(msg('/strategy buy NVDA daily and sell half if it drops 10%'))
  assert.match(texts()[0], /can't save this[\s\S]*sell half if it drops 10%/)
  assert.equal(buttonData(), undefined)
})

test("a stranger can't use /strategy", async () => {
  let called = false
  deps.client = { responses: { parse: async () => { called = true } } }
  await onMessage(msg('/strategy buy NVDA daily', 7))
  assert.equal(called, false)
})
