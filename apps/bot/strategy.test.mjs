// Unit: strategy rule bounds, description, and the Claude call contract (fake client, no network).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate, describe, parseStrategy, deps } from './strategy.mjs'

const rule = (x = {}) => ({ ticker: 'NVDA', usdt: 10, every: 'week', weekday: 'mon', hourUtc: 14, skipEarnings: true, maxPremiumPct: 0.5, unsupported: [], ...x })

test('a normal weekly rule is valid', () => assert.deepEqual(validate(rule()), []))

test('bounds are enforced regardless of what the model returns', () => {
  const bad = {
    ticker: ['nvda', '$(x)', '', 'TOOLONGTICKER'],
    usdt: [0, -5, 1001, NaN],
    hourUtc: [-1, 24, 13.5],
    maxPremiumPct: [-0.1, 1.5, 5],
  }
  for (const [k, vals] of Object.entries(bad)) for (const v of vals) assert.ok(validate(rule({ [k]: v })).length, `${k}=${v}`)
  assert.ok(validate(rule({ every: 'week', weekday: null })).length)
  assert.deepEqual(validate(rule({ every: 'day', weekday: null })), [])
  assert.deepEqual(validate(rule({ maxPremiumPct: null })), [])
})

test('anything the model flagged as unsupported blocks saving', () => {
  const e = validate(rule({ unsupported: ['sell if it drops 10%'] }))
  assert.match(e.join(), /not supported: sell if it drops 10%/)
})

test('describe shows UTC and WIB and every condition', () => {
  const d = describe(rule({ hourUtc: 20 }))
  assert.match(d, /Buy 10 USDT of NVDA every Monday at 20:00 UTC \(03:00 WIB\)/)
  assert.match(d, /skip while earnings limits are active/)
  assert.match(d, /only if ≤ 0\.5% above the real price/)
  assert.match(describe(rule({ every: 'day', weekday: null, skipEarnings: false, maxPremiumPct: null })), /every day[\s\S]*within the guard limit \(1%\)/)
})

test('parseStrategy calls Claude with structured output and returns the parsed rule', async () => {
  let req
  deps.client = { messages: { parse: async (r) => { req = r; return { stop_reason: 'end_turn', parsed_output: rule() } } } }
  assert.deepEqual(await parseStrategy('buy $10 NVDA every monday 9pm WIB skip earnings'), rule())
  assert.equal(req.model, 'claude-opus-5')
  assert.equal(req.output_config.effort, 'low')
  assert.equal(req.output_config.format.type, 'json_schema')
  assert.match(req.system, /WIB = UTC\+7/)
  assert.equal(req.messages[0].content, 'buy $10 NVDA every monday 9pm WIB skip earnings')
})

test('refusal, truncation and unparseable output are errors, never a rule', async () => {
  for (const res of [{ stop_reason: 'refusal', parsed_output: null }, { stop_reason: 'max_tokens', parsed_output: rule() }, { stop_reason: 'end_turn', parsed_output: null }]) {
    deps.client = { messages: { parse: async () => res } }
    await assert.rejects(parseStrategy('x'), /declined|could not parse/)
  }
})
