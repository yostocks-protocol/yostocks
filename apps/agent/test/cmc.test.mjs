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
    assert.deepEqual(r.metrics, { marketCap: 3.91e12, volume24h: 1.42e11, marketCapChange24h: -1.23, btcDominance: 57.8, ethDominance: 12.4 })
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
