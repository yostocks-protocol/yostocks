// Regression: scan() + execute() against recorded RWA responses and a fake `baw`.
// Each test pins a failure we actually hit on BSC mainnet on 2026-09-24.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { FIXTURE, FAKE_BAW, addr, quote, clone, mockFetch, scenario } from './helpers.mjs'

const sc = scenario({})
process.env.BAW = FAKE_BAW
process.env.FAKE_BAW = sc.file
process.env.YO_POLL_MS = '1'
const { scan, execute, scanSell, executeSell } = await import('../yo.mjs')

let restore
before(() => { restore = mockFetch() })
after(() => restore())

const ref = (fx, sym) => Number(fx.dynamic[addr(sym)].data.stockInfo.price)
const mult = (sym) => Number(FIXTURE.dynamic[addr(sym)].data.tokenInfo.sharesMultiplier)
/** tokens out for 100 USDT at `pct`% over the US stock price, multiplier applied */
const fair = (sym, pct = 0, r = ref(FIXTURE, sym.replace(/(on|x|B)$/, 'on'))) => 100 / (r * (1 + pct / 100) * mult(sym))
const quoted = () => sc.calls().filter((c) => c[1] === 'quote').map((c) => c[c.indexOf('--toToken') + 1].toLowerCase())

test('MSTRx: quote with success:true but ~0 tokens out is rejected, never picked', async () => {
  sc.set({ quotes: { [addr('MSTRon')]: quote(fair('MSTRon', 0.3)), [addr('MSTRx')]: quote(0.000000024), [addr('MSTRB')]: quote(fair('MSTRB', 0.2)) } })
  const s = await scan('MSTR', 100)
  const x = s.rows.find((r) => r.t.symbol === 'MSTRx')
  assert.equal(x.ok, false)
  assert.notEqual(s.best.t.symbol, 'MSTRx')
  assert.equal(s.best.t.symbol, 'MSTRB') // cheaper of the two safe routes
})

test('xStocks "No liquidity" error is rejected with the provider message', async () => {
  sc.set({ quotes: { [addr('NVDAon')]: quote(fair('NVDAon', 0.1)), [addr('NVDAB')]: quote(fair('NVDAB', 0.05)) } })
  const s = await scan('NVDA', 100)
  assert.match(s.rows.find((r) => r.t.symbol === 'NVDAx').why, /No liquidity/)
  assert.equal(s.best.t.symbol, 'NVDAB')
})

test('METAx quoted at its stale on-chain price (~-21%) is rejected as off-reference', async () => {
  const metaxPrice = Number(FIXTURE.dynamic[addr('METAx')].data.tokenInfo.price)
  sc.set({ quotes: { [addr('METAx')]: quote(100 / metaxPrice), [addr('METAon')]: quote(fair('METAon', 0.01)) } })
  const s = await scan('META', 100)
  const x = s.rows.find((r) => r.t.symbol === 'METAx')
  assert.equal(x.ok, false)
  assert.ok(x.dev < -15, `dev ${x.dev}`)
  assert.equal(s.best.t.symbol, 'METAon')
})

test('multiplier ≠ 1 is applied: a fair NVDAon quote lands within 0.01% of reference', async () => {
  assert.ok(mult('NVDAon') > 1)
  sc.set({ quotes: { [addr('NVDAon')]: quote(fair('NVDAon')) } })
  const s = await scan('NVDA', 100)
  assert.ok(Math.abs(s.rows.find((r) => r.t.symbol === 'NVDAon').dev) < 0.01)
})

test('no US stock price (off-hours) → falls back to Ondo oracle price / multiplier', async () => {
  const fx = clone(FIXTURE)
  for (const d of Object.values(fx.dynamic)) d.data.stockInfo.price = null
  restore(); restore = mockFetch(fx)
  try {
    sc.set({ quotes: { [addr('NVDAon')]: quote(fair('NVDAon')) } })
    const s = await scan('NVDA', 100)
    const on = fx.dynamic[addr('NVDAon')].data.tokenInfo
    assert.ok(Math.abs(s.ref - Number(on.price) / Number(on.sharesMultiplier)) < 1e-9)
  } finally { restore(); restore = mockFetch() }
})

test('no reference at all (no stock price, no Ondo token) → refuses instead of guessing', async () => {
  const fx = clone(FIXTURE)
  fx.list.data = fx.list.data.filter((t) => !(t.ticker === 'NVDA' && t.type === 1))
  for (const d of Object.values(fx.dynamic)) d.data.stockInfo.price = null
  restore(); restore = mockFetch(fx)
  try {
    sc.set({ quotes: { [addr('NVDAB')]: quote(0.45) } })
    await assert.rejects(scan('NVDA', 100), /no reference price for NVDA/)
  } finally { restore(); restore = mockFetch() }
})

test('undocumented provider types (4, 9) are never quoted even for a known ticker', async () => {
  const fx = clone(FIXTURE)
  fx.list.data.push({ chainId: '56', contractAddress: '0x000000000000000000000000000000000000dEaD', symbol: 'xNVDA', ticker: 'NVDA', type: 4, multiplier: '1' })
  restore(); restore = mockFetch(fx)
  try {
    sc.set({ quotes: {} })
    await scan('NVDA', 100)
    assert.ok(!quoted().includes('0x000000000000000000000000000000000000dead'))
  } finally { restore(); restore = mockFetch() }
})

test('SESSION_EXPIRED (not just NOT_LOGGED_IN) surfaces as a sign-in error', async () => {
  for (const auth of ['SESSION_EXPIRED', 'NOT_LOGGED_IN']) {
    sc.set({ auth })
    await assert.rejects(scan('NVDA', 100), new RegExp(`Agentic Wallet ${auth}: run \`baw auth signin\``))
  }
})

test('ticker not tokenized on BSC → clear error, no quotes requested', async () => {
  const before = sc.calls().length
  await assert.rejects(scan('ZZZZ', 100), /ZZZZ is not tokenized on BSC/)
  assert.equal(sc.calls().length, before)
})

test('paused asset is skipped even when it is the cheapest', async () => {
  const fx = clone(FIXTURE)
  fx.status[addr('NVDAB')].data = { ...fx.status[addr('NVDAB')].data, reasonCode: 'ASSET_PAUSED', reasonMsg: 'stock_split' }
  restore(); restore = mockFetch(fx)
  try {
    sc.set({ quotes: { [addr('NVDAon')]: quote(fair('NVDAon', 0.3)), [addr('NVDAB')]: quote(fair('NVDAB', -0.2)) } })
    const s = await scan('NVDA', 100)
    assert.match(s.rows.find((r) => r.t.symbol === 'NVDAB').why, /ASSET_PAUSED stock_split/)
    assert.equal(s.best.t.symbol, 'NVDAon')
  } finally { restore(); restore = mockFetch() }
})

test('all routes unsafe → no best, nothing to trade', async () => {
  sc.set({ quotes: { [addr('NVDAon')]: quote(fair('NVDAon', 5)), [addr('NVDAB')]: quote(fair('NVDAB', -5)) } })
  assert.equal((await scan('NVDA', 100)).best, undefined)
})

test('execute: swaps USDT → chosen token with explicit slippage, polls to FINISHED', async () => {
  sc.set({ swap: { success: true, data: { orderId: 'o-42' } }, orderStatus: 'FINISHED', txHash: '0xabc' })
  const n = sc.calls().length
  let submitted
  const r = await execute({ contractAddress: addr('NVDAB') }, 5, (id) => { submitted = id })
  assert.deepEqual(r, { orderId: 'o-42', status: 'FINISHED', tx: 'https://bscscan.com/tx/0xabc', got: undefined })
  assert.equal(submitted, 'o-42')
  const swap = sc.calls().slice(n).find((c) => c[1] === 'swap')
  const a = (k) => swap[swap.indexOf(k) + 1]
  assert.equal(a('--toToken'), addr('NVDAB'))
  assert.equal(a('--fromToken'), '0x55d398326f99059fF775485246999027B3197955')
  assert.equal(a('--fromTokenQty'), '5')
  assert.equal(a('--slippage'), '1')
  assert.equal(a('--binanceChainId'), '56')
})

test('execute: FAILED order throws (never reported as filled), rejected swap throws, PENDING is not success', async () => {
  sc.set({ orderStatus: 'FAILED' })
  await assert.rejects(execute({ contractAddress: addr('NVDAB') }, 5), /FAILED/)
  sc.set({ swap: { success: false, error: { name: 'INSUFFICIENT_BALANCE' } } })
  await assert.rejects(execute({ contractAddress: addr('NVDAB') }, 5), /swap rejected.*INSUFFICIENT_BALANCE/)
  sc.set({ orderStatus: 'PENDING' })
  assert.equal((await execute({ contractAddress: addr('NVDAB') }, 5)).status, 'PENDING')
})

test('recorded live quotes (if the recorder was signed in) still pass the guard', async (t) => {
  const live = Object.values(FIXTURE.quotes).some((q) => q.success)
  if (!live) return t.skip('fixtures recorded without a wallet session')
  sc.set({ quotes: FIXTURE.quotes })
  for (const tk of ['NVDA', 'MSTR', 'META']) assert.ok((await scan(tk, 100)).best, `${tk} should have a safe route`)
})

test('execute: swap orderId unknown to `list` (#21, first mainnet buy) → matched by token + amount + time', async () => {
  const USDT = '0x55d398326f99059fF775485246999027B3197955'
  const real = { orderId: '26092400001912775002', status: 'FINISHED', fromToken: USDT, fromTokenQty: '5.000000000000000000', toToken: addr('NVDAB'), toTokenActualQty: '0.022409841731513969', txHash: '0xfe3a3f460a2f278ec91f8dfc550043bf5ed8d9726952bcceb572ace52ef404b9' }
  const other = { ...real, orderId: 'x', fromTokenQty: '7', txHash: '0xother' } // same token, different size: not ours
  sc.set({ swap: { success: true, data: { orderId: '2609240001912775001' } }, idLookupBroken: true, recent: [other, real] })
  const n = sc.calls().length
  const r = await execute({ contractAddress: addr('NVDAB') }, 5)
  assert.equal(r.status, 'FINISHED')
  assert.equal(r.orderId, '26092400001912775002')
  assert.equal(r.tx, 'https://bscscan.com/tx/0xfe3a3f460a2f278ec91f8dfc550043bf5ed8d9726952bcceb572ace52ef404b9')
  assert.equal(r.got, '0.022409841731513969')
  const fallback = sc.calls().slice(n).find((c) => c[1] === 'list' && c.includes('--toToken'))
  assert.equal(fallback[fallback.indexOf('--toToken') + 1], addr('NVDAB'))
  assert.ok(Number(fallback[fallback.indexOf('--startTime') + 1]) > Date.now() - 5 * 60_000)
})

test('execute: id lookup broken and no matching order yet → PENDING, not a fake fill', async () => {
  sc.set({ swap: { success: true, data: { orderId: 'ghost' } }, idLookupBroken: true, recent: [] })
  assert.equal((await execute({ contractAddress: addr('NVDAB') }, 5)).status, 'PENDING')
})

// ---- selling ----
const bal = (symbol, balance) => ({ symbol, address: addr(symbol), binanceChainId: '56', balance: String(balance) })
const HELD = '0.022409841731513969' // what the first mainnet buy left in the wallet
/** USDT out for selling `qty` tokens of `sym` at `pct`% vs the US price */
const sellFor = (sym, qty, pct = 0) => Number(qty) * mult(sym) * ref(FIXTURE, sym.replace(/(on|x|B)$/, 'on')) * (1 + pct / 100)

test('scanSell: finds the held token and prices the sell per share against the reference', async () => {
  sc.set({ balances: [bal('NVDAB', HELD), { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', balance: '5' }], sellQuotes: { [addr('NVDAB')]: quote(sellFor('NVDAB', HELD, 0.06)) } })
  const s = await scanSell('NVDA')
  assert.equal(s.row.t.symbol, 'NVDAB')
  assert.equal(s.qty, HELD, 'all = the exact balance string, no float rounding')
  assert.equal(s.ok, true)
  assert.ok(Math.abs(s.dev - 0.06) < 0.001)
  const q = sc.calls().filter((c) => c[1] === 'quote').at(-1)
  assert.equal(q[q.indexOf('--fromToken') + 1].toLowerCase(), addr('NVDAB'))
  assert.equal(q[q.indexOf('--fromTokenQty') + 1], HELD)
})

test('scanSell: a sell quote far below the real price is rejected (you would be dumping)', async () => {
  sc.set({ balances: [bal('NVDAB', HELD)], sellQuotes: { [addr('NVDAB')]: quote(sellFor('NVDAB', HELD, -3)) } })
  const s = await scanSell('NVDA')
  assert.equal(s.ok, false)
  assert.match(s.why, /-3\.00% off reference/)
})

test('scanSell: Ondo "trade during stock market opening hours" error is surfaced, not traded', async () => {
  const msg = 'Token NVDAon currently has no available liquidity. Please trade during stock market opening hours.'
  sc.set({ balances: [bal('NVDAon', '0.01')], sellQuotes: { [addr('NVDAon')]: { success: false, error: { code: 316008, name: 'SERVICE_ERROR', message: msg } } } })
  const s = await scanSell('NVDA')
  assert.equal(s.ok, false)
  assert.equal(s.why, msg)
})

test('scanSell: holding several NVDA tokens → sells the one with the most shares', async () => {
  sc.set({ balances: [bal('NVDAon', '0.001'), bal('NVDAB', HELD)], sellQuotes: { [addr('NVDAB')]: quote(sellFor('NVDAB', HELD)) } })
  assert.equal((await scanSell('NVDA')).row.t.symbol, 'NVDAB')
})

test('scanSell: partial amount, over-balance, nothing held, bad amount, expired session', async () => {
  sc.set({ balances: [bal('NVDAB', HELD)], sellQuotes: { [addr('NVDAB')]: quote(sellFor('NVDAB', 0.01)) } })
  assert.equal((await scanSell('NVDA', '0.01')).qty, '0.01')
  await assert.rejects(scanSell('NVDA', '1'), /you hold 0\.022409841731513969 NVDAB, can't sell 1/)
  await assert.rejects(scanSell('NVDA', '-1'), /can't sell -1/)
  sc.set({ balances: [] })
  await assert.rejects(scanSell('NVDA'), /you don't hold any NVDA token/)
  sc.set({ auth: 'SESSION_EXPIRED' })
  await assert.rejects(scanSell('NVDA'), /Agentic Wallet SESSION_EXPIRED/)
})

test('executeSell: swaps token → USDT for the exact qty and reports USDT received', async () => {
  const USDT = '0x55d398326f99059fF775485246999027B3197955'
  sc.set({ swap: { success: true, data: { orderId: 'bad-id' } }, idLookupBroken: true, recent: [
    { orderId: 's-1', status: 'FINISHED', fromToken: addr('NVDAB'), fromTokenQty: HELD, toToken: USDT, toTokenActualQty: '4.98', txHash: '0x5e11' },
  ] })
  const n = sc.calls().length
  const r = await executeSell({ contractAddress: addr('NVDAB') }, HELD)
  assert.deepEqual(r, { orderId: 's-1', status: 'FINISHED', tx: 'https://bscscan.com/tx/0x5e11', got: '4.98' })
  const swap = sc.calls().slice(n).find((c) => c[1] === 'swap')
  assert.equal(swap[swap.indexOf('--fromToken') + 1], addr('NVDAB'))
  assert.equal(swap[swap.indexOf('--toToken') + 1], USDT)
  assert.equal(swap[swap.indexOf('--fromTokenQty') + 1], HELD)
})
