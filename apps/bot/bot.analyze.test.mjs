// Integration: /analyze → Pay (x402) → background watch → summary + report file, against fakes.
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FIXTURE, FAKE_BAW, mockFetch, scenario, fakeAnalyst } from '../agent/test/helpers.mjs'

const OWNER = 42
const sc = scenario({})
const dir = mkdtempSync(join(tmpdir(), 'yo-an-'))
Object.assign(process.env, {
  BAW: FAKE_BAW, FAKE_BAW: sc.file, TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_API: 'https://tg.test', YO_OWNER_CHAT_ID: String(OWNER),
  YO_ANALYST_URL: 'https://analyst.test', YO_JOBS: join(dir, 'jobs.json'), YO_DATA: join(dir, 's.json'), YO_JOB_POLL_MS: '1',
})
const { onMessage, onCallback, watchJob } = await import('./bot.mjs')

let sent, fa, restore, msgId
beforeEach(() => {
  sent = []; msgId = 0; fa = fakeAnalyst(); sc.set({})
  restore?.()
  restore = mockFetch(FIXTURE, { tg: (method, body) => { sent.push({ method, ...body }); return ['sendMessage', 'sendPhoto'].includes(method) ? { message_id: ++msgId } : true }, other: (u, i) => fa.handler(u, i) })
})
after(() => restore())
const texts = () => sent.filter((s) => ['sendMessage', 'sendPhoto'].includes(s.method)).map((s) => s.text ?? s.caption)
const tap = (data, chat = OWNER) => onCallback({ id: 'cb', data, message: { chat: { id: chat }, message_id: 1 } })
const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 5)); assert.ok(fn(), 'timed out') }
const signs = () => sc.calls().filter((c) => c[1] === 'sign')

test('/analyze → offer with the price and a Pay button; nothing is signed yet', async () => {
  await onMessage({ chat: { id: OWNER }, text: '/analyze nvda' })
  assert.match(texts()[0], /🧠 <b>NVDA research report<\/b> · Nvidia Corp[\s\S]*Stock Analyze Agent[\s\S]*Price: <b>0\.1 (U|USDT)<\/b>, paid over x402/)
  assert.match(sent[0].reply_markup.inline_keyboard[0][0].text, /^💳 Pay 0\.1 (U|USDT)$/)
  assert.equal(signs().length, 0)
})

test('Pay → signs once, confirms payment with the tx, then delivers the summary and the report file', async () => {
  await onMessage({ chat: { id: OWNER }, text: '/analyze NVDA' })
  const pay = sent[0].reply_markup.inline_keyboard[0][0].callback_data
  const n = signs().length
  await tap(pay)
  assert.equal(signs().length, n + 1)
  assert.match(texts().join('\n'), /✅ <b>Paid 0\.1 USDT<\/b> over x402 · <a href="https:\/\/bscscan\.com\/tx\/0xpaid">/)
  await until(() => sent.some((s) => s.method === 'sendDocument'))
  const doc = sent.find((s) => s.method === 'sendDocument')
  assert.equal(doc.document.name, 'NVDA-analysis.md')
  assert.match(doc.document.text, /Target Price/)
  assert.match(texts().at(-1), /<b>Rating:<\/b> Buy[\s\S]*<b>Target price:<\/b> \$260[\s\S]*Key risks[\s\S]*Export-control/)
  assert.equal(JSON.parse(readFileSync(process.env.YO_JOBS, 'utf8')).find((j) => j.jobId === 'job-1').delivered, true)
  await tap(pay)
  assert.equal(signs().length, n + 1, 'double tap never pays twice')
})

test('a failed but retryable job is resumed for free and still delivered', async () => {
  fa.state.jobs = ['running', 'failed', 'running', 'succeeded']
  const n = signs().length
  const r = await watchJob(OWNER, { ticker: 'NVDA', jobId: 'job-1', jobToken: 'tok-1', paid: '0.1 USDT' })
  assert.equal(r, 'delivered')
  assert.equal(fa.state.resumed, 1)
  assert.equal(signs().length, n, 'resume never signs')
})

test("a stranger sees the x402 offer but gets no Pay button and nothing is signed", async () => {
  const n = signs().length
  await onMessage({ chat: { id: 7 }, text: '/analyze NVDA' })
  assert.match(texts()[0], /Price: <b>0\.1 (U|USDT)<\/b>[\s\S]*owner's wallet only/)
  assert.equal(sent[0].reply_markup, undefined)
  assert.equal(signs().length, n)
})

test('offer shows instantly; if the live price is higher at Pay time, nothing is signed', async () => {
  await onMessage({ chat: { id: OWNER }, text: '/analyze NVDA' })
  assert.equal(fa.seen.length, 0, 'no slow 402 round trip before Pay')
  sc.set({ x402Preview: { success: true, data: { paymentId: 'p2', options: [{ index: 1, status: 'READY_TO_SIGN', reasons: [], tokenSymbol: 'USDT', amount: '0.5' }] } } })
  const n = signs().length
  await tap(sent[0].reply_markup.inline_keyboard[0][0].callback_data)
  assert.equal(signs().length, n)
  assert.match(texts().at(-1), /price is now 0\.5 USDT\. Nothing was paid/)
})
