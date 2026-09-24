// Buys a stock-analysis report from BNB Agent Studio's Stock Analyze Agent over x402, paid from the
// Agentic Wallet. Two stages: quote() reads the 402 challenge (free); pay() signs one option and
// submits the job; poll() fetches the report. Every call is paid (~0.1), so the caller confirms first.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { baw } from './yo.mjs'

export const AGENT = process.env.YO_ANALYST_URL ?? 'https://stock-agent.bnbchain.org'
const JOBS = process.env.YO_JOBS ?? new URL('./data/analyst-jobs.json', import.meta.url).pathname

const body = (ticker) => JSON.stringify({ symbols: [ticker], analysis_type: 'comprehensive' })
const post = (ticker, headers = {}) =>
  fetch(`${AGENT}/x402/analyze/async`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body(ticker), signal: AbortSignal.timeout(30_000) })

/** The price challenge, previewed by the wallet. No signature, no charge. */
export async function quote(ticker) {
  const res = await post(ticker)
  if (res.status !== 402) throw new Error(`expected 402 from the analyst, got ${res.status}`)
  const required = res.headers.get('payment-required')
  if (!required) throw new Error('402 without a payment-required header')
  const pv = await baw('x402-payment', 'preview', '--paymentRequirements', required)
  if (!pv.success) throw new Error(`x402 preview failed: ${JSON.stringify(pv.error)}`)
  const option = pv.data.options.find((o) => o.status === 'READY_TO_SIGN') // pre-sorted, best first
  if (!option) throw new Error(`no payable option: ${pv.data.options.map((o) => `${o.tokenSymbol ?? '?'} ${o.reasons?.join('/')}`).join(', ')}`)
  return { ticker, paymentId: pv.data.paymentId, option, amount: option.amount, token: option.tokenSymbol, approve: option.needApproveFirst }
}

/** Sign the previewed option and submit the paid job. Persists jobId + jobToken before returning. */
export async function pay(q) {
  const sig = await baw('x402-payment', 'sign', '--paymentId', q.paymentId, '--selectedIndex', String(q.option.index))
  if (!sig.success) throw new Error(`x402 sign failed: ${JSON.stringify(sig.error)}`)
  const { paymentHeaderName, paymentHeaderValue, approveTxHash } = sig.data
  if (approveTxHash) await waitTx(approveTxHash)
  let res
  // A signature is single-use. On settlement_pending (503) replay the *same* proof; never sign again.
  for (let i = 0; i < 4; i++) {
    res = await post(q.ticker, { [paymentHeaderName]: paymentHeaderValue })
    if (res.status !== 503) break
    await new Promise((r) => setTimeout(r, 5000))
  }
  if (res.status === 429) throw new Error(`analyst rate limit, retry after ${res.headers.get('retry-after') ?? '?'}s (not re-signing)`)
  if (res.status !== 202 && res.status !== 200) throw new Error(`analyst rejected the paid request: ${res.status} ${await res.text()}`)
  const { jobId, jobToken } = await res.json()
  const settlement = decode(res.headers.get('payment-response'))
  const job = { ticker: q.ticker, jobId, jobToken, paid: `${Number(q.amount)} ${q.token}`, txHash: settlement?.transaction ?? settlement?.txHash ?? null, at: new Date().toISOString() }
  saveJob(job) // the token is the only way to fetch a paid report: store it before anything else can fail
  return job
}

/** One status check. Returns { status, report? , retryable? }. */
export async function poll(job) {
  const res = await fetch(`${AGENT}/x402/jobs/${job.jobId}`, { headers: { 'X-Job-Token': job.jobToken }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`job ${job.jobId}: HTTP ${res.status}`)
  const j = await res.json()
  const status = j.status ?? j.job_status
  if (status === 'succeeded' && j.downloadUrl) return { status, report: await (await fetch(j.downloadUrl)).text() }
  return { status, retryable: j.retryable, error: j.error }
}

/** Free retry of a failed job (no new payment), only when the service says it's retryable. */
export async function resume(job) {
  const res = await fetch(`${AGENT}/x402/jobs/${job.jobId}/resume`, { method: 'POST', headers: { 'X-Job-Token': job.jobToken } })
  return res.ok
}

/** Pull rating / target price / risks out of the markdown report for a short summary. */
export function summarize(md) {
  const line = (re) => md.split('\n').find((l) => re.test(l))?.replace(/[*#>|`_]/g, '').replace(/\s+/g, ' ').trim()
  return {
    rating: line(/\brating\b/i),
    target: line(/target\s*price/i),
    risks: md.split('\n').filter((l) => /\brisk/i.test(l) && /^\s*[-*]/.test(l)).slice(0, 3).map((l) => l.replace(/^\s*[-*]\s*/, '').replace(/[*_`]/g, '').trim()),
  }
}

const decode = (b64) => { try { return b64 ? JSON.parse(Buffer.from(b64, 'base64').toString()) : null } catch { return null } }

async function waitTx(hash) {
  for (let i = 0; i < 20; i++) {
    const h = await baw('wallet', 'tx-history', '--binanceChainId', '56', '--tx', hash)
    if (h.data?.transactions?.[0]?.status === 'confirmed') return
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`permit2 approve ${hash} not confirmed after 60s`)
}

export const loadJobs = () => { try { return JSON.parse(readFileSync(JOBS, 'utf8')) } catch { return [] } }
export function saveJob(job) {
  mkdirSync(dirname(JOBS), { recursive: true })
  writeFileSync(JOBS, JSON.stringify([...loadJobs().filter((j) => j.jobId !== job.jobId), job], null, 1))
}
