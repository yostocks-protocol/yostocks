#!/usr/bin/env node
// Stand-in for the Agentic Wallet CLI. Scenario comes from the JSON file in $FAKE_BAW;
// every call is appended to scenario.log so tests can assert what would have been sent.
import { readFileSync, appendFileSync } from 'node:fs'

const f = JSON.parse(readFileSync(process.env.FAKE_BAW, 'utf8'))
const args = process.argv.slice(2)
const arg = (k) => args[args.indexOf(k) + 1]
if (f.log) appendFileSync(f.log, JSON.stringify(args) + '\n')
const USDT = '0x55d398326f99059ff775485246999027b3197955'
const NO_LIQ = { success: false, error: { code: 100, name: 'SERVICE_ERROR', message: 'No liquidity available, please try again later.' } }

let out
if (f.auth) out = { success: false, error: { code: 10003000, name: f.auth, message: 'Not logged in' } }
else if (args[0] === 'wallet' && args[1] === 'balance') out = { success: true, data: f.balances ?? [] }
else if (args[1] === 'quote' && arg('--toToken').toLowerCase() === USDT) out = f.sellQuotes?.[arg('--fromToken').toLowerCase()] ?? NO_LIQ
else if (args[1] === 'quote') out = f.quotes?.[arg('--toToken').toLowerCase()] ?? NO_LIQ
else if (args[1] === 'swap') out = f.swap ?? { success: true, data: { orderId: 'o-1' } }
else if (args[1] === 'list' && args.includes('--orderId')) out = { success: true, data: { list: f.idLookupBroken ? [] : [{ orderId: arg('--orderId'), status: f.orderStatus ?? 'FINISHED', txHash: f.txHash ?? null }] } }
else if (args[1] === 'list') out = { success: true, data: { list: f.recent ?? [] } } // filtered list (by toToken / startTime)
process.stdout.write(JSON.stringify(out))
process.exit(out.success ? 0 : 1)
