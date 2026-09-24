#!/usr/bin/env node
// yostocks agent: quote a tokenized stock across Ondo / xStocks / bStocks on BSC,
// reject quotes that disagree with the reference price.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpathSync } from 'node:fs'

const run = promisify(execFile)
const BAW = process.env.BAW || 'baw'
const MAX_DEV = Number(process.env.YO_MAX_DEV ?? 1) // % a quote may differ from the reference price
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const API = 'https://www.binance.com/bapi/defi'
const HEADERS = { 'Accept-Encoding': 'identity', 'User-Agent': 'binance-web3/1.1 (Skill)' }
const PROVIDER = { 1: 'Ondo', 2: 'xStocks', 3: 'bStocks' }
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
  if (rows[0].quote?.error?.name === 'NOT_LOGGED_IN') throw new Error('Agentic Wallet not signed in: run `baw auth signin`')

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

function print({ ticker, usdt, ref, rows, best }) {
  console.log(`\n${ticker} · ${usdt} USDT · reference $${ref.toFixed(2)}/share\n`)
  for (const r of rows) {
    const mark = r === best ? '★' : r.ok ? '✓' : '✗'
    const info = r.ok ? `$${r.perShare.toFixed(2)}/share (${r.dev >= 0 ? '+' : ''}${r.dev.toFixed(2)}%)` : r.why
    console.log(`${mark} ${PROVIDER[r.t.type].padEnd(8)} ${r.t.symbol.padEnd(9)} ${info}`)
  }
  console.log(best ? `\nbest: ${best.t.symbol} → ${best.got.toFixed(6)} tokens` : '\nno safe route, not trading')
}

if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
  const [cmd, ticker, amount] = process.argv.slice(2)
  const usdt = Number(amount)
  if (cmd !== 'quote' || !ticker || !(usdt > 0)) {
    console.log('usage: yo quote <TICKER> <USDT amount>')
    process.exit(1)
  }
  const T = ticker.toUpperCase()
  scan(T, usdt).then(print).catch((e) => { console.error(`✗ ${e.message}`); process.exit(1) })
}
