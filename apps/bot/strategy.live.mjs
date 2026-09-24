// Live: real OpenAI call (needs OPENAI_API_KEY). Checks the translations the rule depends on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStrategy, validate } from './strategy.mjs'

const opts = { skip: !process.env.OPENAI_API_KEY && 'set OPENAI_API_KEY' }

test('Indonesian weekly plan: WIB → UTC, earnings skip, premium cap', opts, async () => {
  const r = await parseStrategy('beli $10 NVDA tiap Senin jam 9 malam, skip earnings, premium maks 0.5%')
  assert.deepEqual(validate(r), [])
  assert.deepEqual({ ...r, unsupported: undefined }, { ticker: 'NVDA', usdt: 10, every: 'week', weekday: 'mon', hourUtc: 14, skipEarnings: true, maxPremiumPct: 0.5, unsupported: undefined })
})

test('company name → ticker, daily default hour', opts, async () => {
  const r = await parseStrategy('buy 25 usdt of tesla every day')
  assert.equal(r.ticker, 'TSLA')
  assert.equal(r.every, 'day')
  assert.equal(r.usdt, 25)
})

test('selling / stop-loss is flagged unsupported, so it cannot be saved', opts, async () => {
  const r = await parseStrategy('beli NVDA $10 tiap hari dan jual kalau turun 10%')
  assert.ok(r.unsupported.length > 0)
  assert.ok(validate(r).some((e) => e.startsWith('not supported')))
})
