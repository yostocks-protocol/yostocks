// Records real RWA API responses + real `baw` quotes into fixtures for the offline regression suite.
// Run with WARP on and a signed-in Agentic Wallet: BAW=… node test/record-fixtures.mjs
import { writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const API = 'https://www.binance.com/bapi/defi'
const H = { 'Accept-Encoding': 'identity', 'User-Agent': 'binance-web3/1.1 (Skill)' }
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const TICKERS = ['NVDA', 'MSTR', 'META']
const get = async (p) => (await fetch(API + p, { headers: H })).json()
const baw = async (...a) => {
  try { return JSON.parse((await run(process.env.BAW || 'baw', [...a, '--json'])).stdout) } catch (e) { return JSON.parse(e.stdout) }
}

const list = await get('/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai')
// keep the tickers under test on every chain/provider, plus the undocumented types 4/9 on BSC
list.data = list.data.filter((t) => TICKERS.includes(t.ticker) || (t.chainId === '56' && t.type >= 4))
const out = { recordedAt: new Date().toISOString(), list, dynamic: {}, status: {}, quotes: {} }
for (const t of list.data.filter((t) => t.chainId === '56' && [1, 2, 3].includes(t.type))) {
  const a = t.contractAddress.toLowerCase()
  out.dynamic[a] = await get(`/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai?chainId=56&contractAddress=${t.contractAddress}`)
  out.status[a] = await get(`/v1/public/wallet-direct/buw/wallet/market/token/rwa/asset/market/status/ai?chainId=56&contractAddress=${t.contractAddress}`)
  out.quotes[a] = await baw('market-order', 'quote', '--fromTokenQty', '100', '--fromToken', USDT, '--toToken', t.contractAddress, '--binanceChainId', '56')
}
writeFileSync(new URL('./fixtures/rwa.json', import.meta.url), JSON.stringify(out, null, 1))
console.log(`recorded ${Object.keys(out.dynamic).length} tokens`, Object.entries(out.quotes).map(([a, q]) => `${list.data.find((t) => t.contractAddress.toLowerCase() === a).symbol}:${q.success ? q.data.toCoinAmount : q.error?.name}`).join(' '))
