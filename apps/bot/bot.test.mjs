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
