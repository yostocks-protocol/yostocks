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

