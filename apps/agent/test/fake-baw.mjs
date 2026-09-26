#!/usr/bin/env node
// Stand-in for the Agentic Wallet CLI. Scenario comes from the JSON file in $FAKE_BAW;
// every call is appended to scenario.log so tests can assert what would have been sent.
import { readFileSync, appendFileSync } from 'node:fs'

const all = JSON.parse(readFileSync(process.env.FAKE_BAW, 'utf8'))
const f = { ...all, ...all.wallets?.[process.env.BINANCE_BAW_DIR] } // per-user wallet dirs can override anything
const args = process.argv.slice(2)
const arg = (k) => args[args.indexOf(k) + 1]
if (f.log) appendFileSync(f.log, JSON.stringify(process.env.BINANCE_BAW_DIR?.includes('/wallets/') ? [...args, '@' + process.env.BINANCE_BAW_DIR.split('/').pop()] : args) + '\n')
const USDT = '0x55d398326f99059ff775485246999027b3197955'
const NO_LIQ = { success: false, error: { code: 100, name: 'SERVICE_ERROR', message: 'No liquidity available, please try again later.' } }

let out
if (f.auth) out = { success: false, error: { code: 10003000, name: f.auth, message: 'Not logged in' } }
else if (args[0] === 'x402-payment' && args[1] === 'preview' && /xrpl|solana/.test(Buffer.from(arg('--paymentRequirements'), 'base64').toString() + arg('--paymentRequirements'))) out = { success: false, error: { code: 351741, name: 'SERVICE_ERROR', message: 'unsupported x402 protocol version (only v2 supported)' } } // like the real baw
else if (args[0] === 'x402-payment' && args[1] === 'preview') out = f.x402Preview ?? { success: true, data: { paymentId: 'pay-1', options: [{ index: 1, status: 'READY_TO_SIGN', reasons: [], tokenSymbol: 'USDT', amount: '0.100000000000000000', needApproveFirst: false }] } }
else if (args[0] === 'x402-payment' && args[1] === 'sign') out = f.x402Sign ?? { success: true, data: { paymentHeaderName: 'PAYMENT-SIGNATURE', paymentHeaderValue: `sig-for-${arg('--paymentId')}-${arg('--selectedIndex')}`, approveTxHash: null } }
else if (args[0] === 'wallet' && args[1] === 'tx-history') out = { success: true, data: { binanceChainId: '56', txHash: arg('--tx'), status: f.txStatus ?? 'SUCCESS' } } // real `--tx` shape
else if (args[0] === 'limit-order' && ['buy', 'sell'].includes(args[1])) out = f.limitPlace ?? { success: true, data: { strategyId: `s-${args[1]}-${arg('--triggerPrice')}` } }
else if (args[0] === 'limit-order' && args[1] === 'list') out = { success: true, data: { list: (f.limitOrders ?? []).filter((o) => !args.includes('--strategyId') || o.strategyId === arg('--strategyId')) } }
else if (args[0] === 'limit-order' && args[1] === 'cancel') out = { success: true, data: { strategyId: arg('--strategyId'), status: 'CANCELED' } }
else if (args[0] === 'wallet' && args[1] === 'settings') out = f.settings ?? { success: true, data: { dailyLimit: 500, quotaUsed: 10, quotaLeft: 490, abnormalTxnHandling: 'AutoReject', tradeAllTokens: false, sessionExpireTime: '2026-10-02T14:00:00+00:00' } }
else if (args[0] === 'approvals' && args[1] === 'list') out = { success: true, data: { list: f.approvals ?? [] } }
else if (args[0] === 'approvals' && args[1] === 'revoke') out = { success: true, data: { orderId: 'r-1', status: 'BROADCASTED', txHash: `0xrevoke${arg('--spender').slice(2, 8)}` } }
else if (args[0] === 'auth' && args[1] === 'signin') out = f.signin ?? { success: true, data: { qrCodeId: 'qr-1', expireAt: String(Date.now() + 300_000), urlForWeb: 'https://app.binance.com/uni-qr/test', pairingCode: '123456' } }
else if (args[0] === 'auth' && args[1] === 'verify') out = f.verify ?? { success: true, data: { status: 'SUCCESS' } }
else if (args[0] === 'auth' && args[1] === 'signout') out = { success: true, data: { status: 'LOGGED_OUT' } }
else if (args[0] === 'wallet' && args[1] === 'address') out = { success: true, data: { addresses: [{ binanceChainId: '56', chainName: 'BSC', address: f.address ?? '0x000000000000000000000000000000000000dEaD' }] } }
else if (args[0] === 'wallet' && args[1] === 'balance') out = { success: true, data: f.balances ?? [{ symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', balance: '1000', value: '1000' }] }
else if (args[1] === 'quote' && arg('--toToken').toLowerCase() === USDT) out = f.sellQuotes?.[arg('--fromToken').toLowerCase()] ?? NO_LIQ
else if (args[1] === 'quote') out = f.quotes?.[arg('--toToken').toLowerCase()] ?? NO_LIQ
else if (args[1] === 'swap') out = f.swap ?? { success: true, data: { orderId: 'o-1' } }
else if (args[1] === 'list' && args.includes('--orderId')) out = { success: true, data: { list: f.idLookupBroken ? [] : [{ orderId: arg('--orderId'), status: f.orderStatus ?? 'FINISHED', txHash: f.txHash ?? null }] } }
else if (args[1] === 'list') out = { success: true, data: { list: f.recent ?? [] } } // filtered list (by toToken / startTime)
process.stdout.write(JSON.stringify(out))
process.exit(out.success ? 0 : 1)
