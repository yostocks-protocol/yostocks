// Things the agent does while you're away: "buy if it drops" and "sell higher", plus the wallet's own
// brakes (daily limit, token approvals).
//
// Why not `baw limit-order`: for tokenized stocks it answers `Raw limit orders are not supported.`
// (SERVICE_ERROR code 2, checked live on NVDAB, buy and sell; a BNB limit order in the same wallet works).
// So the agent keeps the condition itself: it watches the real share price and, when the target is
// reached, runs the same guarded swap as the Buy/Sell buttons from the user's own wallet.
import { baw, market, scan, scanSell, execute, executeSell, holdings, assertSignedIn, USDT } from './yo.mjs'

export const TERMINAL = ['FINISHED', 'FAILED', 'EXPIRED', 'CANCELED']
export const MAX_AGE_MS = 30 * 864e5 // a condition nobody hit in 30 days expires
const ok = (r, what) => {
  assertSignedIn(r)
  if (!r.success) throw new Error(`${what}: ${r.error?.message ?? JSON.stringify(r.error)}`)
  return r.data
}

/**
 * Where a target may sit, relative to the real price. Pure.
 * buy: below the price (at or above would just fill now), at most 50% below.
 * sell: above the price, at most 2x. Anything else is refused, never "fixed".
 */
export function checkTrigger(side, sharePrice, ref) {
  if (!(sharePrice > 0) || !(ref > 0)) return 'no price'
  if (side === 'buy' && sharePrice >= ref) return `that's at or above today's price ($${ref.toFixed(2)}); buy now instead`
  if (side === 'buy' && sharePrice < ref * 0.5) return 'more than 50% below today\'s price'
  if (side === 'sell' && sharePrice <= ref) return `that's at or below today's price ($${ref.toFixed(2)})`
  if (side === 'sell' && sharePrice > ref * 2) return "more than double today's price"
  return null
}

/** Has this order's condition been met at `price` (the real share price)? Pure. */
export const reached = (o, price) => (o.side === 'buy' ? price <= o.price : price >= o.price)

/** Check a new "buy if it drops" against today's price; nothing is sent to the chain yet. */
export async function planBuy(ticker, usdt, sharePrice) {
  const { ref } = await market(ticker)
  const why = checkTrigger('buy', sharePrice, ref)
  if (why) throw new Error(`price refused: ${why}`)
  return { side: 'buy', ticker, usdt, price: sharePrice }
}

/** Check a new "sell higher": the price, and that the wallet holds some of this stock. */
export async function planSell(ticker, sharePrice) {
  const [{ ref }, held] = await Promise.all([market(ticker), holdings()])
  const why = checkTrigger('sell', sharePrice, ref)
  if (why) throw new Error(`price refused: ${why}`)
  if (!held.some((h) => h.t.ticker === ticker)) throw new Error(`you don't hold any ${ticker} yet`)
  return { side: 'sell', ticker, price: sharePrice }
}

/**
 * The condition was met: trade now, through the guard, in the current wallet context.
 * Returns { status: 'FINISHED', tx, got } | { status: 'WAIT', why } (guard said no this minute) | { status: 'FAILED', why }.
 */
export async function fill(o) {
  if (o.side === 'buy') {
    const s = await scan(o.ticker, o.usdt)
    if (!s.best) return { status: 'WAIT', why: 'no safe route this minute' }
    if (s.best.perShare > o.price * 1.01) return { status: 'WAIT', why: 'route price above the target' }
    const r = await execute(s.best.t, o.usdt)
    return r.status === 'FINISHED' ? { status: 'FINISHED', tx: r.tx, got: r.got, symbol: s.best.t.symbol } : { status: 'FAILED', why: `order ${r.orderId} ${r.status}` }
  }
  const s = await scanSell(o.ticker, 'all')
  if (!s.ok) return { status: 'WAIT', why: s.why ?? 'sell quote refused this minute' }
  const r = await executeSell(s.row.t, s.qty)
  return r.status === 'FINISHED' ? { status: 'FINISHED', tx: r.tx, got: r.got, symbol: s.row.t.symbol } : { status: 'FAILED', why: `order ${r.orderId} ${r.status}` }
}

/** The wallet's brakes: daily limit and what's left, risky-trade handling, session end, token approvals. */
export async function safety() {
  // `approvals list` takes no chain filter in CLI 1.10.0 (the reference says it does): filter BSC here.
  const [s, a] = await Promise.all([baw('wallet', 'settings'), baw('approvals', 'list').catch(() => ({ success: false }))])
  const settings = ok(s, 'wallet settings')
  return { settings, approvals: a.success ? (a.data.list ?? []).filter((x) => String(x.binanceChainId ?? '56') === '56') : null }
}

/** Revoke every listed approval; returns what was broadcast (not yet confirmed) and what failed. */
export async function revokeAll(list) {
  const out = []
  for (const x of list) {
    const r = await baw('approvals', 'revoke', '--binanceChainId', '56', '--tokenContract', x.tokenContract, '--spender', x.spender, '--type', x.type)
    assertSignedIn(r)
    out.push({ ...x, ok: !!r.success, txHash: r.data?.txHash, error: r.error?.message })
  }
  return out
}
