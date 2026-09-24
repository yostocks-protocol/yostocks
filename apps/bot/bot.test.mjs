import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from './bot.mjs'

test('parses commands', () => {
  assert.deepEqual(parse('/buy nvda 10'), { cmd: '/buy', ticker: 'NVDA', usdt: 10 })
  assert.deepEqual(parse('/quote@yostocks_bot BRK.B 5'), { cmd: '/quote', ticker: 'BRK.B', usdt: 5 })
  assert.equal(parse('/start').ticker, undefined)
})
test('rejects bad amounts and tickers', () => {
  for (const t of ['/buy NVDA', '/buy NVDA -5', '/buy NVDA 5000', '/buy NVDA abc', '/buy $(rm) 5']) assert.ok(parse(t).error, t)
})

test('parses /sell with all, amount, or default all', () => {
  assert.deepEqual(parse('/sell nvda'), { cmd: '/sell', ticker: 'NVDA', amount: 'all' })
  assert.deepEqual(parse('/sell NVDA ALL'), { cmd: '/sell', ticker: 'NVDA', amount: 'all' })
  assert.deepEqual(parse('/sell NVDA 0.01'), { cmd: '/sell', ticker: 'NVDA', amount: '0.01' })
  for (const t of ['/sell', '/sell NVDA -1', '/sell NVDA abc', '/sell $(x)']) assert.ok(parse(t).error, t)
})
