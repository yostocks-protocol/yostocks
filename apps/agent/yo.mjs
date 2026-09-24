#!/usr/bin/env node
// yostocks agent: quote a tokenized stock across Ondo / xStocks / bStocks on BSC,
// reject quotes that disagree with the reference price, buy from the best one via Agentic Wallet.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpathSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'

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

async function baw(...args) {
  try {
    return JSON.parse((await run(BAW, [...args, '--json'])).stdout)
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

export async function scan(ticker, usdt) {
  const list = await api('/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai')
  const tokens = list.filter((t) => t.chainId === '56' && PROVIDER[t.type] && t.ticker === ticker)
  if (!tokens.length) throw new Error(`${ticker} is not tokenized on BSC`)

  const rows = await Promise.all(tokens.map(async (t) => {
    const [dyn, status, quote] = await Promise.all([
      rwa('dynamic', t),
      rwa('status', t),
      baw('market-order', 'quote', '--fromTokenQty', String(usdt), '--fromToken', USDT, '--toToken', t.contractAddress, '--binanceChainId', '56'),
    ])
    return { t, dyn, status, quote, usdt, multiplier: Number(dyn.tokenInfo.sharesMultiplier || t.multiplier || 1) }
  }))
  const auth = rows.find((r) => AUTH_ERRORS.includes(r.quote?.error?.name))
  if (auth) throw new Error(`Agentic Wallet ${auth.quote.error.name}: run \`baw auth signin\``)

  // US stock price when the feed has it, else Ondo's oracle price per share (Ondo tracks within ~0.1%).
  const withStock = rows.find((r) => r.dyn.stockInfo?.price)
  const ondo = rows.find((r) => r.t.type === 1)
  const ref = withStock ? Number(withStock.dyn.stockInfo.price)
    : ondo ? Number(ondo.dyn.tokenInfo.price) / ondo.multiplier : null
  if (!ref) throw new Error(`no reference price for ${ticker}`)

  const judged = rows.map((r) => ({ ...r, ...judge(r, ref) }))
  const best = judged.filter((r) => r.ok).sort((a, b) => a.perShare - b.perShare)[0]
  return { ticker, usdt, ref, rows: judged, best }
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

// Swap USDT → token and wait for a terminal state. An orderId is not a fill.
export async function execute(token, usdt, onSubmit = () => {}) {
  const sub = await baw('market-order', 'swap', '--fromTokenQty', String(usdt), '--fromToken', USDT, '--toToken', token.contractAddress, '--binanceChainId', '56', '--slippage', SLIPPAGE)
  if (!sub.success) throw new Error(`swap rejected: ${JSON.stringify(sub.error)}`)
  const { orderId } = sub.data
  onSubmit(orderId)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const o = (await baw('market-order', 'list', '--orderId', orderId)).data?.list?.[0]
    if (o?.status === 'FINISHED') return { orderId, status: 'FINISHED', tx: `https://bscscan.com/tx/${o.txHash}` }
    if (o?.status === 'FAILED') throw new Error(`order ${orderId} FAILED${o.txHash ? ` tx ${o.txHash}` : ''}`)
  }
  return { orderId, status: 'PENDING' }
}

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

if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
  const [cmd, ticker, amount] = process.argv.slice(2)
  const usdt = Number(amount)
  if (!['quote', 'buy'].includes(cmd) || !ticker || !(usdt > 0)) {
    console.log('usage: yo quote|buy <TICKER> <USDT amount> [--yes]')
    process.exit(1)
  }
  const T = ticker.toUpperCase()
  const job = cmd === 'quote' ? scan(T, usdt).then((s) => console.log('\n' + format(s))) : buy(T, usdt, process.argv.includes('--yes'))
  job.catch((e) => { console.error(`✗ ${e.message}`); process.exit(1) })
}
