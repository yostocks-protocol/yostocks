// Unit: strategy rule bounds, description, and the OpenAI call contract (fake client, no network).
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

const reply = (x) => ({ status: 'completed', output: [], output_parsed: null, ...x })

test('parseStrategy calls OpenAI with a strict JSON schema and returns the parsed rule', async () => {
  let req
  deps.client = { responses: { parse: async (r) => { req = r; return reply({ output_parsed: rule() }) } } }
  assert.deepEqual(await parseStrategy('buy $10 NVDA every monday 9pm WIB skip earnings'), rule())
  assert.equal(req.model, process.env.YO_LLM_MODEL ?? 'gpt-5.4-mini')
  assert.equal(req.reasoning.effort, 'low')
  assert.equal(req.text.format.type, 'json_schema')
  assert.equal(req.text.format.strict, true)
  assert.match(req.instructions, /WIB = UTC\+7/)
  assert.equal(req.input, 'buy $10 NVDA every monday 9pm WIB skip earnings')
})

test('refusal, truncation and unparseable output are errors, never a rule', async () => {
  const cases = [
    reply({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }], output_parsed: rule() }),
    reply({ status: 'incomplete', output_parsed: rule() }),
    reply({ output_parsed: null }),
  ]
  for (const res of cases) {
    deps.client = { responses: { parse: async () => res } }
    await assert.rejects(parseStrategy('x'), /declined|could not parse/)
  }
})
