// Live: the real Binance RWA API. Catches schema drift in the fields the guard depends on.
// YO_LIVE_BAW=1 also runs a real (read-only) quote scan through a signed-in Agentic Wallet.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const API = 'https://www.binance.com/bapi/defi'
const H = { 'Accept-Encoding': 'identity', 'User-Agent': 'binance-web3/1.1 (Skill)' }
const get = async (p) => {
  const j = await (await fetch(API + p, { headers: H, signal: AbortSignal.timeout(20_000) })).json()
  assert.equal(j.success, true, `${p}: ${j.code} ${j.message}`)
  return j.data
}
const KNOWN_REASONS = ['TRADING', 'MARKET_CLOSED', 'MARKET_PAUSED', 'ASSET_PAUSED', 'ASSET_LIMITED', 'UNSUPPORTED', 'MARKET_MAINTENANCE']

const list = await get('/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai')
const nvda = list.filter((t) => t.chainId === '56' && t.ticker === 'NVDA' && [1, 2, 3].includes(t.type))

test('token list: BSC still has Ondo(1) / xStocks(2) / bStocks(3) with the fields we read', () => {
  for (const type of [1, 2, 3]) {
    const t = list.find((x) => x.chainId === '56' && x.type === type)
    assert.ok(t, `no BSC tokens of type ${type}`)
    assert.match(t.contractAddress, /^0x[0-9a-fA-F]{40}$/)
    assert.equal(typeof t.symbol, 'string')
    assert.equal(typeof t.ticker, 'string')
  }
  assert.deepEqual(nvda.map((t) => t.symbol).sort(), ['NVDAB', 'NVDAon', 'NVDAx'])
})

test('dynamic: price and sharesMultiplier are positive numbers for every NVDA token', async () => {
  for (const t of nvda) {
    const d = await get(`/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai?chainId=56&contractAddress=${t.contractAddress}`)
    assert.ok(Number(d.tokenInfo.price) > 0, `${t.symbol} price`)
    assert.ok(Number(d.tokenInfo.sharesMultiplier || t.multiplier) >= 1, `${t.symbol} multiplier`)
    assert.ok('stockInfo' in d && 'price' in d.stockInfo, `${t.symbol} stockInfo.price field`)
  }
})

test('asset status: reasonCode is one the guard knows about', async () => {
  for (const t of nvda) {
    const s = await get(`/v1/public/wallet-direct/buw/wallet/market/token/rwa/asset/market/status/ai?chainId=56&contractAddress=${t.contractAddress}`)
    assert.ok(KNOWN_REASONS.includes(s.reasonCode), `${t.symbol}: unknown reasonCode ${s.reasonCode}`)
  }
})

test('Ondo on-chain price tracks the US price within 2% (the fallback reference assumption)', async (t) => {
  const on = nvda.find((x) => x.type === 1)
  const d = await get(`/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai?chainId=56&contractAddress=${on.contractAddress}`)
  if (!d.stockInfo.price) return t.skip('no US price right now')
  const perShare = Number(d.tokenInfo.price) / Number(d.tokenInfo.sharesMultiplier)
  assert.ok(Math.abs(perShare / Number(d.stockInfo.price) - 1) < 0.02, `${perShare} vs ${d.stockInfo.price}`)
})

test('real scan through Agentic Wallet finds a safe NVDA route', { skip: process.env.YO_LIVE_BAW !== '1' && 'set YO_LIVE_BAW=1 (needs baw signed in)' }, async () => {
  const { scan } = await import('../yo.mjs')
  const s = await scan('NVDA', 10)
  assert.ok(s.best, 'no safe route')
  assert.notEqual(s.best.t.type, 2, 'xStocks has had no BSC liquidity; picking it would be suspicious')
})
