// macropulse economic calendar over x402: multi-network challenge filtered to BSC, digest, payment tx.
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FAKE_BAW, mockFetch, scenario, fakeMacro } from './helpers.mjs'

const sc = scenario({})
Object.assign(process.env, { BAW: FAKE_BAW, FAKE_BAW: sc.file, YO_MACRO_URL: 'https://macro.test/api/calendar' })
const macro = await import('../macro.mjs')
const { bscOnly } = await import('../x402.mjs')

let fm, restore
beforeEach(() => { fm = fakeMacro(); restore?.(); restore = mockFetch(undefined, { other: (u, i) => fm.handler(u, i) }); sc.set({}) })
after(() => restore())

test('bscOnly(): drops Base/XRPL/Solana accepts (baw rejects mixed challenges), passes pure-BSC through', () => {
  const mixed = Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{ network: 'xrpl:0' }, { network: 'eip155:56', amount: '1' }] })).toString('base64')
  assert.deepEqual(JSON.parse(bscOnly(mixed)).accepts, [{ network: 'eip155:56', amount: '1' }])
  const pure = Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{ network: 'eip155:56' }] })).toString('base64')
  assert.equal(bscOnly(pure), pure)
  assert.throws(() => bscOnly(Buffer.from(JSON.stringify({ accepts: [{ network: 'xrpl:0' }] })).toString('base64')), /no BSC payment/)
})

test('paid calendar: the wallet only sees the BSC accept, one signature, digest + settlement tx', async () => {
  const r = await macro.buy(await macro.quote())
  const pv = sc.calls().find((c) => c[1] === 'preview')
  assert.ok(!/xrpl|8453/.test(pv[pv.indexOf('--paymentRequirements') + 1]))
  assert.equal(sc.calls().filter((c) => c[1] === 'sign').length, 1)
  assert.equal(r.week, '2026-09-21')
  assert.deepEqual(r.fed, { next: '2026-10-28', rate: '3.875%' })
  assert.deepEqual(r.events.map((e) => e.currency), ['CHF', 'AUD'])
  assert.equal(r.tx, '0xe21fbbfe6d033971d8f12542e858f39a1969586b9161c3a8397dffeb4f76387a')
})

test('digest() keeps USD and high-impact events, sorted by date, max 6', () => {
  const d = macro.digest({ events: [
    { date: '2026-10-02', day: 'Fri', event: 'NFP', currency: 'USD', impact: 'high' },
    { date: '2026-09-30', day: 'Wed', event: 'GDP', currency: 'USD', impact: 'medium' },
    { date: '2026-09-29', day: 'Tue', event: 'Minor', currency: 'EUR', impact: 'low' },
  ], central_banks: [] })
  assert.deepEqual(d.events.map((e) => e.event), ['GDP', 'NFP'])
  assert.equal(d.fed, null)
  assert.deepEqual(macro.digest(null).events, [])
})
