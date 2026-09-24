// Minimal x402 v2 client on top of the Agentic Wallet: read a 402 challenge, preview it (free),
// then — only after the user confirms — sign once and replay the same request with the proof.
import { baw } from './yo.mjs'

export const TX_POLL_MS = Number(process.env.YO_TX_POLL_MS ?? 3000)
export const decode = (b64) => { try { return b64 ? JSON.parse(Buffer.from(b64, 'base64').toString()) : null } catch { return null } }

/**
 * `baw` rejects a challenge that also lists non-EVM / other-chain accepts ("unsupported x402 protocol
 * version") even when it's v2. Keep only BSC accepts when there are others; pass it through otherwise.
 */
export function bscOnly(required) {
  const ch = decode(required)
  if (!ch?.accepts?.some((a) => a.network !== 'eip155:56')) return required
  const bsc = ch.accepts.filter((a) => a.network === 'eip155:56')
  if (!bsc.length) throw new Error('merchant accepts no BSC payment')
  return JSON.stringify({ ...ch, accepts: bsc })
}

/** Unpaid request → 402 → wallet preview → the option we'd pay with. No signature, no charge. */
export async function challenge(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
  if (res.status !== 402) throw new Error(`expected 402 from ${new URL(url).host}, got ${res.status}`)
  const required = res.headers.get('payment-required')
  if (!required) throw new Error('402 without a payment-required header')
  const pv = await baw('x402-payment', 'preview', '--paymentRequirements', bscOnly(required))
  if (!pv.success) throw new Error(`x402 preview failed: ${JSON.stringify(pv.error)}`)
  // Prefer EIP-3009 (U / USD1): no approval needed, and a permit2 proof was rejected by one merchant (#29).
  const ready = pv.data.options.filter((o) => o.status === 'READY_TO_SIGN') // pre-sorted, best first
  const option = ready.find((o) => o.assetTransferMethod === 'eip3009') ?? ready[0]
  if (!option) throw new Error(`no payable option: ${pv.data.options.map((o) => `${o.tokenSymbol ?? '?'} ${o.reasons?.join('/')}`).join(', ')}`)
  return { url, init, paymentId: pv.data.paymentId, option, amount: option.amount, token: option.tokenSymbol, approve: option.needApproveFirst }
}

/** Sign the previewed option once and replay the request with the proof. Returns the raw Response. */
export async function payAndSend(ch) {
  const sig = await baw('x402-payment', 'sign', '--paymentId', ch.paymentId, '--selectedIndex', String(ch.option.index))
  if (!sig.success) throw new Error(`x402 sign failed: ${JSON.stringify(sig.error)}`)
  const { paymentHeaderName, paymentHeaderValue, approveTxHash } = sig.data
  if (approveTxHash) await waitTx(approveTxHash)
  let res
  // A signature is single-use. On settlement_pending (503) replay the *same* proof; never sign again.
  for (let i = 0; i < 4; i++) {
    res = await fetch(ch.url, { ...ch.init, headers: { ...ch.init.headers, [paymentHeaderName]: paymentHeaderValue }, signal: AbortSignal.timeout(60_000) })
    if (res.status !== 503) break
    await new Promise((r) => setTimeout(r, 5000))
  }
  if (res.status === 429) throw new Error(`rate limited, retry after ${res.headers.get('retry-after') ?? '?'}s (not re-signing)`)
  return res
}

/** Read a body that may be cut off mid-stream (CMC closed the socket after a paid 200): keep what arrived. */
export async function readAll(res) {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const dec = new TextDecoder()
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += dec.decode(value, { stream: true })
    }
  } catch { /* partial body is still worth parsing */ }
  return text
}

export const rejection = (ch, res, body) => {
  const detail = decode(res.headers.get('payment-response'))
  return new Error(`${new URL(ch.url).host} rejected the paid request (${ch.token} via ${ch.option.assetTransferMethod}): ${res.status} ${body}${detail ? ` ${JSON.stringify(detail)}` : ''}`)
}

async function waitTx(hash) {
  for (let i = 0; i < 20; i++) {
    // `tx-history --tx` answers { data: { txHash, status: 'SUCCESS' } }, not the list shape of plain tx-history.
    const h = await baw('wallet', 'tx-history', '--binanceChainId', '56', '--tx', hash)
    const status = String(h.data?.status ?? h.data?.transactions?.[0]?.status ?? '').toUpperCase()
    if (['SUCCESS', 'CONFIRMED'].includes(status)) return
    if (['FAILED', 'FAIL'].includes(status)) throw new Error(`permit2 approve ${hash} failed on-chain`)
    await new Promise((r) => setTimeout(r, TX_POLL_MS))
  }
  throw new Error(`permit2 approve ${hash} not confirmed after 60s`)
}
