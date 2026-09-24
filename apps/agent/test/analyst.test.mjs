// x402 purchase of a stock analysis: every path that could charge twice or lose a paid report.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FAKE_BAW, mockFetch, scenario, fakeAnalyst } from './helpers.mjs'

const sc = scenario({})
const JOBS = join(mkdtempSync(join(tmpdir(), 'yo-jobs-')), 'jobs.json')
Object.assign(process.env, { BAW: FAKE_BAW, FAKE_BAW: sc.file, YO_JOBS: JOBS, YO_ANALYST_URL: 'https://analyst.test' })
const analyst = await import('../analyst.mjs')

let fa, restore
beforeEach(() => { fa = fakeAnalyst(); restore?.(); restore = mockFetch(undefined, { other: (u, i) => fa.handler(u, i) }); sc.set({}) })
after(() => restore())
const signs = () => sc.calls().filter((c) => c[0] === 'x402-payment' && c[1] === 'sign')

test('quote reads the 402 challenge and previews it, never signs', async () => {
  const n = signs().length
  const q = await analyst.quote('NVDA')
  assert.equal(q.token, 'USDT')
  assert.equal(Number(q.amount), 0.1)
  const pv = sc.calls().find((c) => c[1] === 'preview')
  assert.ok(pv[pv.indexOf('--paymentRequirements') + 1].length > 20, 'passes the base64 challenge through')
  assert.equal(signs().length, n)
  assert.equal(fa.seen[0].headers['payment-signature'], undefined)
})

test('quote with no payable option explains why (e.g. insufficient balance)', async () => {
  sc.set({ x402Preview: { success: true, data: { paymentId: 'p', options: [{ index: 1, status: 'ACTION_REQUIRED', reasons: ['INSUFFICIENT_BALANCE'], tokenSymbol: 'U' }] } } })
  await assert.rejects(analyst.quote('NVDA'), /no payable option: U INSUFFICIENT_BALANCE/)
})

test('pay signs once, replays with PAYMENT-SIGNATURE, saves jobId + jobToken, reads the settlement tx', async () => {
  const q = await analyst.quote('NVDA')
  const job = await analyst.pay(q)
  assert.equal(signs().length, 1)
  const paid = fa.seen.find((r) => r.headers['payment-signature'])
  assert.equal(paid.headers['payment-signature'], 'sig-for-pay-1-1')
  assert.deepEqual({ jobId: job.jobId, jobToken: job.jobToken, paid: job.paid, txHash: job.txHash }, { jobId: 'job-1', jobToken: 'tok-1', paid: '0.1 USDT', txHash: '0xpaid' })
  assert.equal(JSON.parse(readFileSync(JOBS, 'utf8')).find((j) => j.jobId === 'job-1').jobToken, 'tok-1')
})

test('settlement_pending (503) replays the same proof; never a second signature', async () => {
  fa.state.submit = [503, 503, 202]
  const n = signs().length
  await analyst.pay(await analyst.quote('NVDA'))
  assert.equal(signs().length, n + 1)
  const proofs = fa.seen.filter((r) => r.headers['payment-signature']).map((r) => r.headers['payment-signature'])
  assert.equal(proofs.length, 3)
  assert.equal(new Set(proofs).size, 1)
})

test('rate limited (429) → error with Retry-After, no re-sign', async () => {
  fa.state.submit = [429]
  const n = signs().length
  await assert.rejects(analyst.pay(await analyst.quote('NVDA')), /rate limit, retry after 120s \(not re-signing\)/)
  assert.equal(signs().length, n + 1)
})

test('permit2 approve is confirmed before the paid replay', async () => {
  sc.set({ x402Sign: { success: true, data: { paymentHeaderName: 'PAYMENT-SIGNATURE', paymentHeaderValue: 'sig', approveTxHash: '0xapprove' } } })
  await analyst.pay(await analyst.quote('NVDA'))
  const calls = sc.calls()
  assert.ok(calls.findIndex((c) => c[1] === 'tx-history' && c.includes('0xapprove')) > calls.findIndex((c) => c[1] === 'sign'))
})

test('poll returns the report on success and summarize() extracts rating, target and risks', async () => {
  const r = await analyst.poll({ jobId: 'job-1', jobToken: 'tok-1' })
  assert.equal(r.status, 'succeeded')
  const s = analyst.summarize(r.report)
  assert.match(s.rating, /Rating: Buy/)
  assert.match(s.target, /Target Price: \$260/)
  assert.deepEqual(s.risks, ['Valuation risk: premium multiple', 'Export-control risk in China'])
  await assert.rejects(analyst.poll({ jobId: 'job-1', jobToken: 'wrong' }), /HTTP 403/)
})
