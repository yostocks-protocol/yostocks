#!/usr/bin/env node
// yostocks agent: quote a tokenized stock across Ondo / xStocks / bStocks on BSC,
// reject quotes that disagree with the reference price, buy from the best one (or sell) via Agentic Wallet.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpathSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { AsyncLocalStorage } from 'node:async_hooks'

const run = promisify(execFile)
const BAW = process.env.BAW || 'baw'
const MAX_DEV = Number(process.env.YO_MAX_DEV ?? 1) // % a quote may differ from the reference price
const SLIPPAGE = process.env.YO_SLIPPAGE ?? '1' // %
const POLL_MS = Number(process.env.YO_POLL_MS ?? 3000) // order status poll interval, 30 polls max
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const API = 'https://www.binance.com/bapi/defi'
const HEADERS = { 'Accept-Encoding': 'identity', 'User-Agent': 'binance-web3/1.1 (Skill)' }
const PROVIDER = { 1: 'Ondo', 2: 'xStocks', 3: 'bStocks' }
const AUTH_ERRORS = ['NOT_LOGGED_IN', 'SESSION_EXPIRED']
const BLOCKED = ['ASSET_PAUSED', 'UNSUPPORTED', 'MARKET_MAINTENANCE', 'MARKET_PAUSED']

async function api(path) {
  const res = await fetch(API + path, { headers: HEADERS })
  const j = await res.json()
  if (!j.success) throw new Error(`${path}: ${j.code} ${j.message}`)
  return j.data
}

/** Which Agentic Wallet session baw uses: wallet.run(dir, fn) points every baw call inside fn at that BINANCE_BAW_DIR. */
export const wallet = new AsyncLocalStorage()

export async function baw(...args) {
  const dir = wallet.getStore()
  try {
    return JSON.parse((await run(BAW, [...args, '--json'], dir ? { env: { ...process.env, BINANCE_BAW_DIR: dir } } : {})).stdout)
  } catch (e) {
    if (e.stdout) return JSON.parse(e.stdout) // baw exits 1 with a JSON error body
    throw e
  }
}

const rwa = (kind, t) =>
  api(`/${kind === 'dynamic' ? 'v2' : 'v1'}/public/wallet-direct/buw/wallet/market/token/rwa/${kind === 'dynamic' ? 'dynamic' : 'asset/market/status'}/ai?chainId=56&contractAddress=${t.contractAddress}`)

// Per-share price a quote implies, checked against the reference. Pure, so it's testable.
export function judge({ usdt, quote, multiplier, status }, ref, maxDev = MAX_DEV) {
  if (!quote?.success) return { ok: false, why: quote?.error?.message ?? 'no quote' }
  if (BLOCKED.includes(status?.reasonCode)) return { ok: false, why: `${status.reasonCode} ${status.reasonMsg ?? ''}`.trim() }
  const got = Number(quote.data.toCoinAmount)
  const perShare = usdt / got / multiplier
  const dev = (perShare / ref - 1) * 100
  if (!(got > 0) || !Number.isFinite(dev)) return { ok: false, got, why: 'quote returns ~0 tokens' }
  if (Math.abs(dev) > maxDev) return { ok: false, got, perShare, dev, why: `${dev.toFixed(2)}% off reference` }
  return { ok: true, got, perShare, dev }
}

// Every BSC token of a ticker with live data, plus the reference price per share.
async function market(ticker) {
  const list = await api('/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai')
  const tokens = list.filter((t) => t.chainId === '56' && PROVIDER[t.type] && t.ticker === ticker)
  if (!tokens.length) throw new Error(`${ticker} is not tokenized on BSC`)
  const rows = await Promise.all(tokens.map(async (t) => {
    const [dyn, status] = await Promise.all([rwa('dynamic', t), rwa('status', t)])
    return { t, dyn, status, multiplier: Number(dyn.tokenInfo.sharesMultiplier || t.multiplier || 1) }
  }))
  // US stock price when the feed has it, else Ondo's oracle price per share (Ondo tracks within ~0.1%).
  const withStock = rows.find((r) => r.dyn.stockInfo?.price)
  const ondo = rows.find((r) => r.t.type === 1)
  const ref = withStock ? Number(withStock.dyn.stockInfo.price)
    : ondo ? Number(ondo.dyn.tokenInfo.price) / ondo.multiplier : null
  if (!ref) throw new Error(`no reference price for ${ticker}`)
  return { rows, ref }
}

function assertSignedIn(...responses) {
  const e = responses.find((r) => AUTH_ERRORS.includes(r?.error?.name))
  if (e) throw new Error(`Agentic Wallet ${e.error.name}: run \`baw auth signin\``)
}

export async function scan(ticker, usdt) {
  const m = await market(ticker)
  const rows = await Promise.all(m.rows.map(async (r) => ({
    ...r,
    usdt,
    quote: await baw('market-order', 'quote', '--fromTokenQty', String(usdt), '--fromToken', USDT, '--toToken', r.t.contractAddress, '--binanceChainId', '56'),
  })))
  assertSignedIn(...rows.map((r) => r.quote))
  const judged = rows.map((r) => ({ ...r, ...judge(r, m.ref) }))
  const best = judged.filter((r) => r.ok).sort((a, b) => a.perShare - b.perShare)[0]
  return { ticker, usdt, ref: m.ref, rows: judged, best }
}

/** Tokenized stocks held on BSC (any provider), with the wallet's own USD value. */
export async function holdings() {
  const [list, bal] = await Promise.all([
    api('/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai'),
    baw('wallet', 'balance', '--binanceChainId', '56'),
  ])
  assertSignedIn(bal)
  if (!bal.success) throw new Error(`wallet balance failed: ${JSON.stringify(bal.error)}`)
  const stocks = new Map(list.filter((t) => t.chainId === '56' && PROVIDER[t.type]).map((t) => [t.contractAddress.toLowerCase(), t]))
  return bal.data
    .filter((b) => stocks.has(b.address?.toLowerCase()) && Number(b.balance) > 0)
    .map((b) => ({ t: stocks.get(b.address.toLowerCase()), qty: b.balance, usd: Number(b.value ?? 0) }))
    .sort((a, b) => b.usd - a.usd)
}

/** Quote selling `amount` tokens ('all' or a number) of the ticker token held with the most shares. */
export async function scanSell(ticker, amount = 'all') {
  const [m, bal] = await Promise.all([market(ticker), baw('wallet', 'balance', '--binanceChainId', '56')])
  assertSignedIn(bal)
  if (!bal.success) throw new Error(`wallet balance failed: ${JSON.stringify(bal.error)}`)
  const held = m.rows
    .map((r) => ({ ...r, balance: bal.data.find((b) => b.address?.toLowerCase() === r.t.contractAddress.toLowerCase())?.balance }))
    .filter((r) => Number(r.balance) > 0)
    .sort((a, b) => b.balance * b.multiplier - a.balance * a.multiplier)
  if (!held.length) throw new Error(`you don't hold any ${ticker} token`)
  const r = held[0]
  const qty = amount === 'all' ? r.balance : String(amount)
  if (!(Number(qty) > 0) || Number(qty) > Number(r.balance)) throw new Error(`you hold ${r.balance} ${r.t.symbol}, can't sell ${qty}`)
  const quote = await baw('market-order', 'quote', '--fromTokenQty', qty, '--fromToken', r.t.contractAddress, '--toToken', USDT, '--binanceChainId', '56')
  assertSignedIn(quote)
  // judge() prices usdt / tokens / multiplier; for a sell that's USDT received per share given up.
  const usdtOut = Number(quote.data?.toCoinAmount)
  const j = judge({ usdt: usdtOut, quote: quote.success ? { success: true, data: { toCoinAmount: qty } } : quote, multiplier: r.multiplier, status: r.status }, m.ref)
  return { ticker, ref: m.ref, row: r, qty, usdtOut, held, ...j }
}

export function format({ ticker, usdt, ref, rows, best }) {
  const lines = [`${ticker} · ${usdt} USDT · reference $${ref.toFixed(2)}/share`, '']
  for (const r of rows) {
    const mark = r === best ? '★' : r.ok ? '✓' : '✗'
    const info = r.ok ? `$${r.perShare.toFixed(2)}/share (${r.dev >= 0 ? '+' : ''}${r.dev.toFixed(2)}%)` : r.why
    lines.push(`${mark} ${PROVIDER[r.t.type].padEnd(8)} ${r.t.symbol.padEnd(9)} ${info}`)
  }
  lines.push('', best ? `best: ${best.t.symbol} → ${best.got.toFixed(6)} tokens` : 'no safe route, not trading')
  return lines.join('\n')
}

// Swap and wait for a terminal state. An orderId is not a fill.
export async function swap(from, to, qty, onSubmit = () => {}) {
  const since = Date.now() - 60_000
  const sub = await baw('market-order', 'swap', '--fromTokenQty', String(qty), '--fromToken', from, '--toToken', to, '--binanceChainId', '56', '--slippage', SLIPPAGE)
  if (!sub.success) throw new Error(`swap rejected: ${JSON.stringify(sub.error)}`)
  const { orderId } = sub.data
  onSubmit(orderId)
  const find = async () => {
    const byId = (await baw('market-order', 'list', '--orderId', orderId)).data?.list?.[0]
    if (byId) return byId
    // The orderId from `swap` isn't always one `list` knows (#21), so match our order by tokens,
    // amount and time. ponytail: two same-size swaps of one pair within a minute could swap matches.
    const recent = (await baw('market-order', 'list', '--binanceChainId', '56', '--toToken', to, '--startTime', String(since), '--pageSize', '5')).data?.list ?? []
    return recent.find((o) => o.fromToken?.toLowerCase() === from.toLowerCase() && Number(o.fromTokenQty) === Number(qty))
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const o = await find()
    if (o?.status === 'FINISHED') return { orderId: o.orderId, status: 'FINISHED', tx: `https://bscscan.com/tx/${o.txHash}`, got: o.toTokenActualQty }
    if (o?.status === 'FAILED') throw new Error(`order ${o.orderId} FAILED${o.txHash ? ` tx ${o.txHash}` : ''}`)
  }
  return { orderId, status: 'PENDING' }
}

/** Buy `token` with `usdt` USDT. */
export const execute = (token, usdt, onSubmit) => swap(USDT, token.contractAddress, usdt, onSubmit)
/** Sell `qty` of `token` for USDT. */
export const executeSell = (token, qty, onSubmit) => swap(token.contractAddress, USDT, qty, onSubmit)

async function buy(ticker, usdt, yes) {
  const s = await scan(ticker, usdt)
  console.log('\n' + format(s))
  if (!s.best) return process.exit(2)
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const a = await rl.question(`\nswap ${usdt} USDT → ${s.best.t.symbol} (slippage ${SLIPPAGE}%)? [y/N] `)
    rl.close()
    if (a.trim().toLowerCase() !== 'y') return console.log('cancelled')
  }
  const r = await execute(s.best.t, usdt, (id) => console.log(`submitted order ${id}, confirming…`))
  console.log(r.status === 'FINISHED' ? `✓ filled · tx ${r.tx}` : `still PENDING after 30 polls, check: baw market-order list --orderId ${r.orderId}`)
}

async function sell(ticker, amount, yes) {
  const s = await scanSell(ticker, amount)
  console.log(`\n${ticker} · sell ${s.qty} ${s.row.t.symbol} · reference $${s.ref.toFixed(2)}/share`)
  if (!s.ok) return console.log(`✗ not selling: ${s.why}`), process.exit(2)
  console.log(`→ ${s.usdtOut.toFixed(4)} USDT ($${s.perShare.toFixed(2)}/share, ${s.dev >= 0 ? '+' : ''}${s.dev.toFixed(2)}%)`)
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const a = await rl.question(`\nswap ${s.qty} ${s.row.t.symbol} → USDT (slippage ${SLIPPAGE}%)? [y/N] `)
    rl.close()
    if (a.trim().toLowerCase() !== 'y') return console.log('cancelled')
  }
  const r = await executeSell(s.row.t, s.qty, (id) => console.log(`submitted order ${id}, confirming…`))
  console.log(r.status === 'FINISHED' ? `✓ sold for ${r.got} USDT · tx ${r.tx}` : `still PENDING after 30 polls, check: baw market-order list --orderId ${r.orderId}`)
}

if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
  const [cmd, ticker, amount] = process.argv.slice(2)
  const T = ticker?.toUpperCase()
  const yes = process.argv.includes('--yes')
  let job
  if (cmd === 'sell' && T) job = sell(T, amount && amount !== '--yes' ? amount : 'all', yes)
  else if (['quote', 'buy'].includes(cmd) && T && Number(amount) > 0) job = cmd === 'quote' ? scan(T, Number(amount)).then((s) => console.log('\n' + format(s))) : buy(T, Number(amount), yes)
  else {
    console.log('usage: yo quote|buy <TICKER> <USDT amount> [--yes]\n       yo sell <TICKER> [token amount|all] [--yes]')
    process.exit(1)
  }
  job.catch((e) => { console.error(`✗ ${e.message}`); process.exit(1) })
}
