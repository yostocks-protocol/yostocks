// Buys a stock-analysis report from BNB Agent Studio's Stock Analyze Agent over x402, paid from the
// Agentic Wallet. Two stages: quote() reads the 402 challenge (free); pay() signs one option and
// submits the job; poll() fetches the report. Every call is paid (~0.1), so the caller confirms first.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { challenge, payAndSend, readAll, rejection, decode } from './x402.mjs'

export const AGENT = process.env.YO_ANALYST_URL ?? 'https://stock-agent.bnbchain.org'
const JOBS = process.env.YO_JOBS ?? new URL('./data/analyst-jobs.json', import.meta.url).pathname

const request = (ticker) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ symbols: [ticker], analysis_type: 'comprehensive' }),
})

/** Last price seen, so an offer can be shown before the (slow, ~16s) 402 round trip. */
export const lastPrice = { amount: '0.1', token: 'U' }

/** The price challenge, previewed by the wallet. No signature, no charge. */
export async function quote(ticker) {
  const ch = await challenge(`${AGENT}/x402/analyze/async`, request(ticker))
  Object.assign(lastPrice, { amount: String(Number(ch.amount)), token: ch.token })
  return { ...ch, ticker }
}

/** Sign the previewed option and submit the paid job. Persists jobId + jobToken before returning. */
export async function pay(q) {
  const res = await payAndSend(q)
  if (res.status !== 202 && res.status !== 200) throw rejection(q, res, await readAll(res))
  const { jobId, jobToken } = JSON.parse(await readAll(res))
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

export const loadJobs = () => { try { return JSON.parse(readFileSync(JOBS, 'utf8')) } catch { return [] } }
export function saveJob(job) {
  mkdirSync(dirname(JOBS), { recursive: true })
  writeFileSync(JOBS, JSON.stringify([...loadJobs().filter((j) => j.jobId !== job.jobId), job], null, 1))
}
