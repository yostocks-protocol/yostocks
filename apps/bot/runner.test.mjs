// Unit + integration: schedule math and runOnce() with an in-memory store and fake scan/execute.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastSlot, due, runOnce, DAILY_CAP, GRACE_MS } from './runner.mjs'

const T = (iso) => Date.parse(iso)
const weekly = { ticker: 'NVDA', usdt: 10, every: 'week', weekday: 'mon', hourUtc: 14, skipEarnings: true, maxPremiumPct: 0.5, unsupported: [] }
const daily = { ...weekly, every: 'day', weekday: null }
// 2026-09-28 is a Monday
const MON_14 = T('2026-09-28T14:00:00Z')

test('lastSlot: daily before/after the hour, weekly across the week boundary', () => {
  assert.equal(lastSlot(daily, T('2026-09-28T13:59:00Z')), T('2026-09-27T14:00:00Z'))
  assert.equal(lastSlot(daily, T('2026-09-28T14:00:00Z')), T('2026-09-28T14:00:00Z'))
  assert.equal(lastSlot(weekly, T('2026-09-28T13:00:00Z')), T('2026-09-21T14:00:00Z')) // Monday before the hour
  assert.equal(lastSlot(weekly, T('2026-10-01T09:00:00Z')), MON_14) // Thursday
  assert.equal(lastSlot(weekly, T('2026-10-04T23:59:00Z')), MON_14) // Sunday
  assert.equal(lastSlot({ ...weekly, weekday: 'sun', hourUtc: 0 }, T('2026-09-28T00:30:00Z')), T('2026-09-27T00:00:00Z'))
})

test('due: saved after the slot waits for the next one; on time runs; >2h late is missed; handled slots are not re-run', () => {
  const s = { rule: weekly, createdAt: '2026-09-28T15:00:00Z' }
  assert.equal(due(s, T('2026-09-28T15:30:00Z')), null)
  const t = { rule: weekly, createdAt: '2026-09-20T00:00:00Z' }
  assert.equal(due(t, MON_14 - 1), 'missed') // slot of the 21st came after createdAt and is >2h ago
  assert.equal(due({ ...t, lastSlot: '2026-09-21T14:00:00.000Z' }, MON_14 - 1), null)
  assert.equal(due({ ...t, lastSlot: '2026-09-21T14:00:00.000Z' }, MON_14), 'run')
  assert.equal(due({ ...t, lastSlot: '2026-09-21T14:00:00.000Z' }, MON_14 + GRACE_MS), 'run')
  assert.equal(due({ ...t, lastSlot: '2026-09-21T14:00:00.000Z' }, MON_14 + GRACE_MS + 1), 'missed')
  assert.equal(due({ ...t, lastSlot: new Date(MON_14).toISOString() }, MON_14 + 60_000), null)
})

// ---- runOnce harness ----
function harness(strategies, opts = {}) {
  const { rows = [], exec = { status: 'FINISHED', orderId: 'o1', tx: 'https://bscscan.com/tx/0x1' }, scanError } = opts
  // `best: undefined` must mean "no safe route", so don't use a destructuring default for it
  const best = 'best' in opts ? opts.best : { t: { symbol: 'NVDAB', contractAddress: '0xb' }, dev: 0.1, perShare: 223 }
  let data = structuredClone(strategies)
  const calls = { scan: 0, execute: [], say: [] }
  return {
    calls,
    data: () => data,
    deps: (now) => ({
      now,
      store: { load: () => structuredClone(data), save: (l) => { data = structuredClone(l) } },
      scan: async (ticker, usdt) => { calls.scan++; if (scanError) throw new Error(scanError); return { rows, best } },
      execute: async (t, usdt) => { calls.execute.push({ t, usdt }); return exec },
      say: async (chat, text) => { calls.say.push({ chat, text }) },
    }),
  }
}
const S = (id, rule = weekly, x = {}) => ({ id, chat: 42, rule, createdAt: '2026-09-21T15:00:00.000Z', ...x })

test('runOnce: fills the due strategy once, records the run, reports the tx; a second pass is a no-op', async () => {
  const h = harness([S('a')])
  const r = await runOnce(h.deps(MON_14 + 60_000))
  assert.equal(r.a.status, 'FINISHED')
  assert.deepEqual(h.calls.execute.map((c) => [c.t.symbol, c.usdt]), [['NVDAB', 10]])
  assert.equal(h.data()[0].lastSlot, new Date(MON_14).toISOString())
  assert.equal(h.data()[0].runs.length, 1)
  assert.match(h.calls.say[0].text, /✓ strategy #a · NVDA 10 USDT filled NVDAB\nhttps:\/\/bscscan\.com\/tx\/0x1/)
  assert.equal(h.calls.say[0].chat, 42)
  assert.deepEqual(await runOnce(h.deps(MON_14 + 120_000)), {})
  assert.equal(h.calls.execute.length, 1)
})

test('runOnce: earnings limits, premium cap and no safe route each skip without trading', async () => {
  const earnings = harness([S('e')], { rows: [{ t: { symbol: 'NVDAon' }, status: { reasonCode: 'ASSET_LIMITED', reasonMsg: 'earnings' } }] })
  assert.match((await runOnce(earnings.deps(MON_14))).e.why, /earnings limits active on NVDAon/)
  const premium = harness([S('p')], { best: { t: { symbol: 'NVDAB' }, dev: 0.8 } })
  assert.match((await runOnce(premium.deps(MON_14))).p.why, /best premium 0\.80% > 0\.5%/)
  const none = harness([S('n')], { best: undefined })
  assert.equal((await runOnce(none.deps(MON_14))).n.why, 'no safe route')
  for (const h of [earnings, premium, none]) {
    assert.equal(h.calls.execute.length, 0)
    assert.match(h.calls.say[0].text, /^⏭ .* skipped:/)
    assert.ok(h.data()[0].lastSlot, 'slot consumed so it is not retried every minute')
  }
})

test('runOnce: earnings on a strategy that did not ask to skip earnings still trades', async () => {
  const h = harness([S('e', { ...weekly, skipEarnings: false })], { rows: [{ t: { symbol: 'NVDAon' }, status: { reasonCode: 'ASSET_LIMITED', reasonMsg: 'earnings' } }] })
  assert.equal((await runOnce(h.deps(MON_14))).e.status, 'FINISHED')
})

test(`runOnce: daily cap (${DAILY_CAP} USDT) across strategies, pending orders count`, async () => {
  const big = { ...daily, usdt: 30, maxPremiumPct: null, skipEarnings: false }
  const h = harness([S('x', big), S('y', big)])
  const r = await runOnce(h.deps(MON_14))
  assert.equal(r.x.status, 'FINISHED')
  assert.equal(r.y.status, 'SKIPPED')
  assert.match(r.y.why, /daily cap 50 USDT reached \(spent 30\)/)
  assert.equal(h.calls.execute.length, 1)

  const p = harness([S('x', big), S('y', big)], { exec: { status: 'PENDING', orderId: 'o9' } })
  const r2 = await runOnce(p.deps(MON_14))
  assert.equal(r2.x.status, 'PENDING')
  assert.equal(r2.y.status, 'SKIPPED', 'a pending order still counts toward the cap')
})

test('runOnce: cap resets the next UTC day', async () => {
  const big = { ...daily, usdt: 30, maxPremiumPct: null, skipEarnings: false }
  const h = harness([S('x', big, { runs: [{ at: '2026-09-27T14:00:00.000Z', usdt: 45, status: 'FINISHED' }], lastSlot: '2026-09-27T14:00:00.000Z' })])
  assert.equal((await runOnce(h.deps(MON_14))).x.status, 'FINISHED')
})

test('runOnce: wallet session expiry is an ERROR reported to the user, not a crash', async () => {
  const h = harness([S('s')], { scanError: 'Agentic Wallet SESSION_EXPIRED: run `baw auth signin`' })
  const r = await runOnce(h.deps(MON_14))
  assert.equal(r.s.status, 'ERROR')
  assert.match(h.calls.say[0].text, /^✗ strategy #s .* error: Agentic Wallet SESSION_EXPIRED/)
  assert.equal(h.calls.execute.length, 0)
})

test('runOnce: missed slot (bot was down >2h) is skipped without quoting', async () => {
  const h = harness([S('m')])
  const r = await runOnce(h.deps(MON_14 + GRACE_MS + 60_000))
  assert.match(r.m.why, /missed its slot/)
  assert.equal(h.calls.scan, 0)
})

test('runOnce: run history is capped at 20 entries', async () => {
  const runs = Array.from({ length: 20 }, (_, i) => ({ at: `2026-08-${String(i + 1).padStart(2, '0')}T14:00:00.000Z`, usdt: 10, status: 'FINISHED' }))
  const h = harness([S('d', daily, { runs, lastSlot: '2026-09-27T14:00:00.000Z' })])
  await runOnce(h.deps(MON_14))
  assert.equal(h.data()[0].runs.length, 20)
  assert.equal(h.data()[0].runs.at(-1).status, 'FINISHED')
  assert.equal(h.data()[0].runs[0].at, '2026-08-02T14:00:00.000Z')
})
