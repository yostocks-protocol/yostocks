// Things the Agentic Wallet does while you're away: limit orders ("buy if it drops", "sell higher"),
// plus the wallet's own brakes (daily limit, token approvals). Same guard idea as yo.mjs: prices are
// per share, checked against the real stock price before anything is placed.
import { baw, market, holdings, assertSignedIn, USDT } from './yo.mjs'

const SLIPPAGE = process.env.YO_SLIPPAGE ?? '1' // %
export const TERMINAL = ['FINISHED', 'FAILED', 'EXPIRED', 'CANCELED']
const ok = (r, what) => {
  assertSignedIn(r)
  if (!r.success) throw new Error(`${what}: ${r.error?.message ?? JSON.stringify(r.error)}`)
  return r.data
}

/**
 * Where a trigger may sit, relative to the real price. Pure.
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

/** The token limit orders use for a ticker: bStocks (Ondo tokens are refused by limit orders), else xStocks. */
async function limitToken(ticker) {
  const m = await market(ticker)
  const row = m.rows.find((r) => r.t.type === 3) ?? m.rows.find((r) => r.t.type === 2)
  if (!row) throw new Error(`no ${ticker} token supports limit orders`)
  return { ...row, ref: m.ref }
}

/** Buy `usdt` of the ticker when a share drops to `sharePrice`. Returns { strategyId, trigger, token }. */
export async function placeBuy(ticker, usdt, sharePrice) {
  const r = await limitToken(ticker)
  const why = checkTrigger('buy', sharePrice, r.ref)
  if (why) throw new Error(`price refused: ${why}`)
  const trigger = +(sharePrice * r.multiplier).toFixed(4) // the order triggers on the TOKEN's USD price
  const d = ok(await baw('limit-order', 'buy', '--triggerPrice', String(trigger), '--fromTokenQty', String(usdt), '--fromToken', USDT,
    '--toToken', r.t.contractAddress, '--binanceChainId', '56', '--slippage', SLIPPAGE), 'limit buy')
  return { strategyId: d.strategyId, trigger, token: r.t }
}

/** Sell every held share of the ticker's limit-order token when a share reaches `sharePrice`. */
export async function placeSell(ticker, sharePrice) {
  const r = await limitToken(ticker)
  const why = checkTrigger('sell', sharePrice, r.ref)
  if (why) throw new Error(`price refused: ${why}`)
  const held = (await holdings()).find((h) => h.t.contractAddress.toLowerCase() === r.t.contractAddress.toLowerCase())
  if (!held) throw new Error(`you don't hold ${r.t.symbol}, the token that supports limit orders`)
  const trigger = +(sharePrice * r.multiplier).toFixed(4)
  const d = ok(await baw('limit-order', 'sell', '--triggerPrice', String(trigger), '--fromTokenQty', String(held.qty), '--fromToken', r.t.contractAddress,
    '--toToken', USDT, '--binanceChainId', '56', '--slippage', SLIPPAGE), 'limit sell')
  return { strategyId: d.strategyId, trigger, token: r.t, qty: held.qty, shares: Number(held.qty) * r.multiplier }
}

export const order = async (strategyId) => ok(await baw('limit-order', 'list', '--strategyId', String(strategyId)), 'limit order').list?.[0] ?? null
export const cancel = async (strategyId) => ok(await baw('limit-order', 'cancel', '--strategyId', String(strategyId)), 'cancel')

/** The wallet's brakes: daily limit and what's left, risky-trade handling, session end, token approvals. */
export async function safety() {
  const [s, a] = await Promise.all([baw('wallet', 'settings'), baw('approvals', 'list', '--binanceChainId', '56')])
  const settings = ok(s, 'wallet settings')
  return { settings, approvals: a.success ? a.data.list ?? [] : null }
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
