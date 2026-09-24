// Global crypto market snapshot from CoinMarketCap's MCP server, paid per call over x402 ($0.01).
import { challenge, payAndSend, readAll, rejection, decode } from './x402.mjs'

export const CMC = process.env.YO_CMC_URL ?? 'https://mcp.coinmarketcap.com/x402/mcp'
const TOOL = 'get_global_metrics_latest'

const request = () => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: TOOL, arguments: {} } }),
})

export const lastPrice = { amount: '0.01', token: 'U' }

export async function quote() {
  const ch = await challenge(CMC, request())
  Object.assign(lastPrice, { amount: String(Number(ch.amount)), token: ch.token })
  return ch
}

/** Pay once and return { metrics, raw, flowId }. A body cut off after payment still yields what arrived. */
export async function buy(ch) {
  const res = await payAndSend(ch)
  const text = await readAll(res)
  if (res.status !== 200) throw rejection(ch, res, text)
  const settlement = decode(res.headers.get('payment-response'))
  const raw = parseMcp(text)
  return { metrics: metrics(raw), raw, flowId: settlement?.x402FlowId ?? null, paid: `${Number(ch.amount)} ${ch.token}`, partial: raw == null }
}

/** MCP tools/call result as plain JSON or SSE `data:` lines → the tool's payload (parsed if it's JSON). */
export function parseMcp(text) {
  const candidates = [text, ...text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())]
  for (const c of candidates) {
    let msg
    try { msg = JSON.parse(c) } catch { continue }
    const content = msg?.result?.structuredContent ?? msg?.result?.content?.find((x) => x.type === 'text')?.text ?? msg?.result
    if (content == null) continue
    if (typeof content !== 'string') return content
    try { return JSON.parse(content) } catch { return content }
  }
  return null
}

/** Find the first numeric value for any of `keys`, anywhere in the object. */
function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return null
  for (const [k, v] of Object.entries(obj)) if (keys.includes(k) && Number.isFinite(Number(v)) && v !== null && v !== '') return Number(v)
  for (const v of Object.values(obj)) { const r = pick(v, keys); if (r != null) return r }
  return null
}

export function metrics(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    marketCap: pick(raw, ['total_market_cap', 'totalMarketCap', 'total_market_cap_usd']),
    volume24h: pick(raw, ['total_volume_24h', 'totalVolume24h', 'total_volume_24h_usd']),
    marketCapChange24h: pick(raw, ['total_market_cap_yesterday_percentage_change', 'marketCapChange24h', 'total_market_cap_change_24h']),
    btcDominance: pick(raw, ['btc_dominance', 'btcDominance']),
    ethDominance: pick(raw, ['eth_dominance', 'ethDominance']),
  }
}
