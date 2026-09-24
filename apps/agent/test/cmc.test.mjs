// CoinMarketCap x402 market snapshot: parsing JSON / SSE, a body cut off after payment, rejection.
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { FAKE_BAW, mockFetch, scenario, fakeCmc } from './helpers.mjs'

const sc = scenario({})
Object.assign(process.env, { BAW: FAKE_BAW, FAKE_BAW: sc.file, YO_CMC_URL: 'https://cmc.test/x402/mcp' })
const cmc = await import('../cmc.mjs')

let fc, restore
beforeEach(() => { fc = fakeCmc(); restore?.(); restore = mockFetch(undefined, { other: (u, i) => fc.handler(u, i) }); sc.set({}) })
after(() => restore())
const signs = () => sc.calls().filter((c) => c[1] === 'sign').length

for (const mode of ['json', 'sse']) {
  test(`paid call (${mode}) → metrics, flow id, one signature, MCP tools/call body`, async () => {
    fc.state.mode = mode
    const n = signs()
    const r = await cmc.buy(await cmc.quote())
    assert.equal(signs(), n + 1)
    assert.deepEqual(r.snapshot.fearGreed, { index: 74, label: 'Greed', lastWeek: 64 })
    assert.equal(r.snapshot.marketCap.value, '$2.88T')
    assert.equal(r.flowId, '792cd109-29ce-441c-bf98-4bd3456d1b06')
    assert.equal(r.paid, '0.1 USDT') // fake preview default
    const body = JSON.parse(fc.seen.at(-1).body)
    assert.equal(body.method, 'tools/call')
    assert.equal(body.params.name, 'get_global_metrics_latest')
  })
}

test('connection cut after payment (seen live) → no crash, marked partial, still reports the payment', async () => {
  fc.state.mode = 'cut'
  const r = await cmc.buy(await cmc.quote())
  assert.equal(r.partial, true)
  assert.equal(r.metrics, null)
  assert.equal(r.flowId, '792cd109-29ce-441c-bf98-4bd3456d1b06')
})

test('rejected payment names the host and method', async () => {
  fc.state.mode = 'reject'
  await assert.rejects(cmc.buy(await cmc.quote()), /cmc\.test rejected the paid request \(\w+ via [^)]*\): 402/)
})

test('parseMcp handles plain JSON, SSE and structuredContent; metrics() finds nested keys', () => {
  assert.deepEqual(cmc.parseMcp('{"result":{"structuredContent":{"btc_dominance":50}}}'), { btc_dominance: 50 })
  assert.equal(cmc.parseMcp('garbage'), null)
  assert.equal(cmc.metrics({ a: { b: { eth_dominance: '12.5' } } }).ethDominance, 12.5)
  assert.equal(cmc.metrics('not an object'), null)
})

test('sections(): the real CMC schema (grouped, display strings) → readable items, definitions dropped', () => {
  const raw = {
    last_updated: '24 September 2026 12:00 AM UTC+0',
    market_size: {
      definition: 'Market size captures the aggregate USD value of the entire crypto asset class…',
      total_crypto_market_cap_usd: { current: '2.88 T', percent_change: { '24h': '+0.39177%', '7d': '+10.7%' }, yearly: { max: { value: '4.28 T' } } },
    },
    liquidity: { definition: 'Liquidity metrics track how…', total_volume_24h_usd: { current: '98.1 B', percent_change: { '24h': '-3.2%' } } },
  }
  assert.deepEqual(cmc.sections(raw), [
    { title: 'Market size', items: [{ label: 'Total crypto market cap', current: '2.88 T', change24h: '+0.39177%' }] },
    { title: 'Liquidity', items: [{ label: 'Total volume 24h', current: '98.1 B', change24h: '-3.2%' }] },
  ])
  assert.deepEqual(cmc.sections(null), [])
})

test('snapshot() on the real payload; sections() never renders nested objects as text', async () => {
  const { readFileSync } = await import('node:fs')
  const raw = JSON.parse(readFileSync(new URL('./fixtures/cmc-global.json', import.meta.url), 'utf8'))
  const x = cmc.snapshot(raw)
  assert.deepEqual(x.fearGreed, { index: 74, label: 'Greed', lastWeek: 64 })
  assert.deepEqual(x.marketCap, { value: '$2.88T', d24: 0.39177, d7: 10.7 })
  assert.equal(x.btcDominance, 58.92)
  assert.deepEqual(x.altSeason, { index: 55, yesterday: 45 })
  assert.equal(cmc.snapshot({ foo: 1 }), null)
  for (const sec of cmc.sections(raw)) for (const it of sec.items) assert.ok(!it.current.includes('[object'), `${sec.title}/${it.label}`)
})
