// Test helpers: recorded RWA fixtures behind a fetch mock, and fake-baw scenarios.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/rwa.json', import.meta.url), 'utf8'))
export const FAKE_BAW = new URL('./fake-baw.mjs', import.meta.url).pathname
export const clone = (x) => structuredClone(x)

/** BSC token address for `symbol` (e.g. "MSTRx") from the fixture list. */
export const addr = (symbol, fx = FIXTURE) => fx.list.data.find((t) => t.chainId === '56' && t.symbol === symbol).contractAddress.toLowerCase()

/** Quote response the way baw returns it. */
export const quote = (toCoinAmount) => ({ success: true, data: { toCoinAmount: String(toCoinAmount), slippage: 0.01 } })

/** Serve Binance RWA calls from `fx`; route tg.test to `tg(method, body)`, other *.test hosts to `other(url, init)`; block everything else. */
export function mockFetch(fx = FIXTURE, { tg, other } = {}) {
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const u = new URL(url)
    if (u.hostname === 'www.binance.com') {
      const a = u.searchParams.get('contractAddress')?.toLowerCase()
      const meta = { success: true, data: { icon: `/logos/${a}.png`, companyInfo: { companyName: 'Nvidia Corp' } } }
      const body = u.pathname.includes('/detail/list/') ? fx.list : u.pathname.includes('/dynamic/') ? fx.dynamic[a] : u.pathname.includes('/status/') ? fx.status[a] : u.pathname.includes('/rwa/meta/') ? (fx.meta?.[a] ?? meta) : null
      if (!body) throw new Error(`unmocked ${url}`)
      return Response.json(body)
    }
    if (tg && u.hostname === 'tg.test') {
      const body = init.body instanceof FormData
        ? Object.fromEntries(await Promise.all([...init.body].map(async ([k, v]) => [k, typeof v === 'string' ? v : { name: v.name, text: await v.text() }])))
        : JSON.parse(init.body)
      return Response.json({ ok: true, result: await tg(u.pathname.split('/').pop(), body) })
    }
    if (other && u.hostname.endsWith('.test')) return other(u, init ?? {})
    throw new Error(`network blocked in tests: ${url}`)
  }
  return () => { globalThis.fetch = real }
}

/** Write a fake-baw scenario; returns { file, calls() } where calls() = parsed argv of every baw call. */
export function scenario(s) {
  const dir = mkdtempSync(join(tmpdir(), 'yo-'))
  const file = join(dir, 'baw.json')
  const log = join(dir, 'calls.log')
  writeFileSync(log, '')
  const set = (next) => writeFileSync(file, JSON.stringify({ ...next, log }))
  set(s)
  return { file, set, calls: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) }
}

/** A fake Stock Analyze Agent (x402) on analyst.test. `state` controls its answers; `seen` records requests. */
export function fakeAnalyst(state = {}) {
  const seen = []
  const challenge = Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{ scheme: 'exact', network: 'eip155:56', amount: '100000000000000000' }] })).toString('base64')
  const handler = async (u, init) => {
    const headers = Object.fromEntries(new Headers(init.headers ?? {}))
    seen.push({ path: u.pathname, method: init.method ?? 'GET', headers })
    if (u.hostname === 'files.test') return new Response(state.report ?? '# NVDA\n**Rating:** Buy\n**Target Price:** $260 (+17%)\n- Valuation risk: premium multiple\n- Export-control risk in China\n')
    if (u.pathname === '/x402/analyze/async') {
      const sig = headers['payment-signature']
      if (!sig) return new Response('{"error":"Payment Required"}', { status: 402, headers: { 'payment-required': challenge } })
      const next = (state.submit ??= [202]).length > 1 ? state.submit.shift() : state.submit[0]
      if (next === 202) return Response.json({ jobId: 'job-1', jobToken: 'tok-1' }, { status: 202, headers: { 'payment-response': Buffer.from(JSON.stringify({ success: true, transaction: '0xpaid' })).toString('base64') } })
      return new Response('{}', { status: next, headers: next === 429 ? { 'retry-after': '120' } : {} })
    }
    if (u.pathname.endsWith('/resume')) { state.resumed = (state.resumed ?? 0) + 1; return new Response('{}', { status: 200 }) }
    if (u.pathname.startsWith('/x402/jobs/')) {
      if (headers['x-job-token'] !== 'tok-1') return new Response('{}', { status: 403 })
      const s = (state.jobs ??= ['succeeded']).length > 1 ? state.jobs.shift() : state.jobs[0]
      return Response.json(s === 'succeeded' ? { status: s, downloadUrl: 'https://files.test/report.md' } : s === 'failed' ? { status: s, retryable: true } : { status: s })
    }
    return new Response('not found', { status: 404 })
  }
  return { handler, seen, state }
}

/** A fake CoinMarketCap MCP x402 endpoint on cmc.test. state.mode: 'json' | 'sse' | 'cut' (close after payment) | 'reject'. */
export function fakeCmc(state = {}) {
  const seen = []
  const metrics = { data: { quote: { USD: { total_market_cap: 3.91e12, total_volume_24h: 1.42e11, total_market_cap_yesterday_percentage_change: -1.23 } }, btc_dominance: 57.8, eth_dominance: 12.4 } }
  const rpc = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(metrics) }] } }
  const handler = async (u, init) => {
    const headers = Object.fromEntries(new Headers(init.headers ?? {}))
    seen.push({ headers, body: init.body })
    if (!headers['payment-signature']) return new Response('{"error":"Provide PAYMENT-SIGNATURE"}', { status: 402, headers: { 'payment-required': Buffer.from('{"x402Version":2}').toString('base64') } })
    const pr = Buffer.from(JSON.stringify({ x402Version: 2, x402FlowId: '792cd109-29ce-441c-bf98-4bd3456d1b06', status: 'settled' })).toString('base64')
    if (state.mode === 'reject') return new Response('{"error":"payment_rejected"}', { status: 402 })
    if (state.mode === 'cut') {
      const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('event: message\ndata: {"jsonrpc"')); c.error(new TypeError('terminated')) } })
      return new Response(body, { status: 200, headers: { 'payment-response': pr } })
    }
    const text = state.mode === 'sse' ? `event: message\ndata: ${JSON.stringify(rpc)}\n\n` : JSON.stringify(rpc)
    return new Response(text, { status: 200, headers: { 'payment-response': pr } })
  }
  return { handler, seen, state }
}
