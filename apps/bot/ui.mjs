// Telegram message templates (HTML parse mode). Pure functions: data in, HTML string out.
const PROVIDER = { 1: 'Ondo', 2: 'xStocks', 3: 'bStocks' }

export const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const usd = (n) => `$${Number(n).toFixed(2)}`
const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`
const qty = (n) => Number(n).toFixed(6)

// ---- button-first home: plain words, names instead of tickers, details behind "Why?" ----
export const TICKERS = ['NVDA', 'TSLA', 'AAPL', 'MSTR', 'META', 'GOOGL', 'SPY', 'QQQ']
export const NAMES = { NVDA: 'NVIDIA', TSLA: 'Tesla', AAPL: 'Apple', MSTR: 'Strategy', META: 'Meta', GOOGL: 'Google', SPY: 'S&P 500', QQQ: 'Nasdaq 100' }
export const AMOUNTS = [5, 10, 25]
export const nameOf = (ticker, company) => NAMES[ticker] ?? company?.replace(/\s+(Corp|Inc|Corporation|Incorporated|Ltd|plc)\.?$/i, '') ?? ticker
const rows = (btns, n) => btns.reduce((r, b, i) => (i % n ? r[r.length - 1].push(b) : r.push([b]), r), [])
const shares = (n) => { const x = Number(n); return x >= 1 ? x.toFixed(2) : x.toPrecision(3) }
const vs = (d) => (Math.abs(d) < 0.005 ? 'at the stock price' : `${Math.abs(d).toFixed(2)}% ${d > 0 ? 'above' : 'below'} the stock price`)
const home$ = { text: '🏠 Home', callback_data: 'home' }
const mine$ = { text: '💼 My stocks', callback_data: 'pf' }
const connect$ = { text: '🔗 Connect Binance to buy', callback_data: 'cw' }
export const doneButtons = { inline_keyboard: [[mine$, home$]] }

const move = (pct) => (Number.isFinite(pct) ? `${pct >= 0 ? '🟢 +' : '🔴 −'}${Math.abs(pct).toFixed(1)}%` : '')
/** Home picture: one bar per stock, name and price on the left, 24h change as the bar. A Chart.js config as JS (the label formatter is a function). */
export const board = (prices) => {
  const j = JSON.stringify
  return `{type:'bar',data:{labels:${j(prices.map((p) => `${nameOf(p.ticker)}   ${usd(p.price)}`))},datasets:[{data:${j(prices.map((p) => Number(p.change.toFixed(2))))},backgroundColor:${j(prices.map((p) => (p.change >= 0 ? '#3ecf8e' : '#ff6b6b')))},borderRadius:6,barThickness:26}]},options:{indexAxis:'y',layout:{padding:{left:10,right:20,top:10,bottom:10}},plugins:{legend:{display:false},title:{display:true,text:'US stocks · 24h change',color:'#f0f0f5',font:{size:22,weight:'bold'},padding:{bottom:18}},datalabels:{anchor:'end',align:'end',offset:6,color:'#f0f0f5',font:{size:16,weight:'bold'},formatter:(v)=>(v>=0?'+':'−')+Math.abs(v).toFixed(1)+'%'}},scales:{x:{display:false,grace:'30%'},y:{ticks:{color:'#f0f0f5',font:{size:18}},grid:{display:false}}}}}`
}
/** prices: [{ ticker, price, change }] listed in text, only when the board picture isn't available. */
export const home = (prices = []) => [
  '👋 <b>Buy US stocks with USDT</b>',
  'I only buy when the price matches the real stock price.',
  ...(prices.length ? ['', ...prices.map((p) => `<b>${esc(nameOf(p.ticker))}</b> · ${usd(p.price)} · ${move(p.change)}`), '<i>24h change</i>'] : []),
  '',
  'Tap one for details, or type any ticker (like <code>AMD</code>).',
].join('\n')
/** canTrade: a connected wallet (the owner's or the user's own): My stocks + Disconnect, else Connect. */
export const homeButtons = (canTrade) => ({
  inline_keyboard: [
    ...rows(TICKERS.map((t) => ({ text: NAMES[t], callback_data: `stk:${t}` })), 2),
    canTrade ? [mine$, { text: '🔌 Disconnect', callback_data: 'dw' }] : [connect$],
  ],
})

// ---- connect your own Agentic Wallet ----
export const connect = ({ pairingCode }) => [
  '🔗 <b>Connect Binance</b>',
  `Tap <b>Open Binance</b> and approve. The app shows the code <b>${esc(pairingCode)}</b>.`,
  '<i>On a computer? Scan this QR code with the Binance app.</i>',
].join('\n')
export const connectButtons = (url) => ({ inline_keyboard: [[{ text: '📲 Open Binance', url }]] })
const addFunds = (address) => `Send USDT on <b>BNB Smart Chain</b> to:\n<code>${esc(address)}</code>\n<i>Tap the address to copy it.</i>`
/** usdt: spendable USDT on BSC, or null if unknown. */
export const connected = (address, usdt) =>
  usdt == null || usdt >= AMOUNTS[0] || !address ? `✅ <b>Connected!</b>${usdt ? ` You have ${usd(usdt)} to spend.` : ''}` : `✅ <b>Connected!</b> Now add USDT to start.\n${addFunds(address)}`
export const notEnough = (need, have, address) => `💸 <b>Not enough USDT.</b> You have ${usd(have)}, this needs ${usd(need)}.${address ? `\n${addFunds(address)}` : ''}`
export const connectFailed = '⌛ Not connected: the code expired. Tap Connect to try again.'
export const disconnected = '🔌 Disconnected.'
export const sessionEnded = '🔐 <b>Please connect Binance again.</b>\nFor your safety the connection lasts up to 7 days.'
export const connectFirst = '🔒 Connect Binance first. It takes a few seconds.'
export const connectOffer = { inline_keyboard: [[connect$], [home$]] }
export const askTicker = '🔎 Type a ticker, for example <code>AMD</code>.'

const MARKET = [[/pre/i, 'Pre-market · token 24/7'], [/after|post/i, 'After hours · token 24/7'], [/off|clos/i, 'Closed · token 24/7'], [/open|regular|trad/i, 'Open']]
/** Key facts as [label, value] rows, from the scan's own RWA data. */
function facts(rows = []) {
  const si = rows.find((r) => r.dyn?.stockInfo?.price)?.dyn.stockInfo ?? {}
  const tok = (rows.find((r) => r.t?.type === 3) ?? rows[0])?.dyn
  const out = []
  if (Number(si.marketCap)) out.push(['Market cap', big(Number(si.marketCap))])
  if (Number(si.priceLow52w) && Number(si.priceHigh52w)) out.push(['52-week', `${usd(si.priceLow52w)} – ${usd(si.priceHigh52w)}`])
  if (Number(si.dividendYield) > 0) out.push(['Dividend', `${Number(si.dividendYield).toFixed(2)}% / yr`])
  const status = rows.find((r) => r.dyn?.statusInfo?.marketStatus)?.dyn.statusInfo.marketStatus // only Ondo reports it
  const m = MARKET.find(([re]) => re.test(status ?? ''))
  if (m) out.push(['US market', m[1]])
  return { change: Number(tok?.tokenInfo?.priceChangePct24h), rows: out }
}
const firstSentence = (t = '') => { const x = t.split(/(?<=\.)\s/)[0] ?? ''; return x.length > 140 ? `${x.slice(0, 137)}…` : x }
const arrow = (pct) => `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}%`

/** One stock: name, price, what the company does, a small facts table, one verdict line. Provider details sit behind Details. */
export function stockCard({ ticker, ref, best, rows }, { company, about } = {}) {
  const f = facts(rows)
  const w = Math.max(0, ...f.rows.map(([k]) => k.length)) + 2
  return [
    `<b>${esc(nameOf(ticker, company))}</b> · ${esc(ticker)}`,
    `<b>${usd(ref)}</b>${Number.isFinite(f.change) ? `   ${arrow(f.change)} today` : ''}`,
    ...(about ? [`<i>${esc(firstSentence(about))}</i>`] : []),
    ...(f.rows.length ? ['', `<pre>${f.rows.map(([k, v]) => esc(k.padEnd(w) + v)).join('\n')}</pre>`] : []),
    '',
    best
      ? `✅ <b>Fair price</b> · via ${PROVIDER[best.t.type]}, ${vs(best.dev)}`
      : "⚠️ <b>Buying paused</b> · on-chain prices don't match the real price right now",
  ].join('\n')
}
/** canBuy: amount buttons + Other. guest: a good price but no wallet yet, so one Connect button that comes back to this stock. */
export const stockButtons = (id, ticker, canBuy, guest = false) => ({
  inline_keyboard: [
    ...(canBuy ? [AMOUNTS.map((a) => ({ text: `Buy $${a}`, callback_data: `b:${id}:${a}` }))] : []),
    ...(guest ? [[{ ...connect$, callback_data: `cw:${ticker}` }]] : []),
    [...(canBuy ? [{ text: '✏️ Other', callback_data: `amt:${id}` }] : []), { text: 'ℹ️ Details', callback_data: `why:${ticker}` }, home$],
  ],
})
export const askAmount = (ticker) => `✏️ How much USDT of <b>${esc(nameOf(ticker))}</b>? Type an amount from $1 to $1,000.`
export const askAmountMarkup = { force_reply: true, input_field_placeholder: 'e.g. 15' }
export const badAmount = 'Type a number from 1 to 1000, like <code>15</code>.'
const money = (n) => (Number.isInteger(n) ? `$${n}` : usd(n))
export const confirmBuy = (usdt, ticker) => `Buy <b>${money(usdt)}</b> of <b>${esc(nameOf(ticker))}</b>?\n<i>The price is checked again right before buying.</i>`
export const confirmButtons = (id, usdt) => ({ inline_keyboard: [[{ text: `✅ Buy ${money(usdt)}`, callback_data: `b:${id}:${usdt}` }, { text: 'Cancel', callback_data: `no:${id}` }]] })
export const whyButtons = (ticker) => ({ inline_keyboard: [[{ text: '← Back', callback_data: `stk:${ticker}` }, home$]] })

const signed = (n) => `${n < 0 ? '−' : '+'}${usd(Math.abs(n))}`
const change = (pnl, cost) => `${pnl < 0 ? '📉' : '📈'} ${signed(pnl)}${cost > 0 ? ` (${pnl < 0 ? '−' : '+'}${Math.abs((pnl / cost) * 100).toFixed(1)}%)` : ''}`

/** My stocks: value, profit/loss on what's held, profit already taken from sales, one line per stock. */
export function portfolio({ rows: items, value, cost, unrealized, realized }) {
  if (!items.length) return "💼 You don't own any stocks yet. Pick one to start:"
  return [
    `💼 <b>Your stocks</b> · ${usd(value)}`,
    ...(cost > 0 ? [`${change(unrealized, cost)} since you bought`] : []),
    ...(Math.abs(realized) >= 0.005 ? [`💵 ${signed(realized)} from stocks you sold`] : []),
    '',
    ...items.map((h) => `<b>${esc(nameOf(h.t.ticker))}</b> · ${shares(Number(h.qty) * Number(h.t.multiplier || 1))} shares · ${usd(h.usd)}${h.pnl == null ? '' : ` · ${change(h.pnl, h.cost)}`}`),
  ].join('\n')
}
export const portfolioButtons = (items) => ({
  inline_keyboard: [
    ...rows([...new Set(items.map((h) => h.t.ticker))].map((t) => ({ text: `Sell ${nameOf(t)}`, callback_data: `sl:${t}` })), 2),
    [home$],
  ],
})

export const buying = (usdt, ticker) => `⏳ Buying <b>$${esc(usdt)}</b> of ${esc(nameOf(ticker))}… this takes a few seconds.`
export const selling = (ticker) => `⏳ Selling your ${esc(nameOf(ticker))}… this takes a few seconds.`

/** Telegram's command menu (setMyCommands) and the text shown before a user presses Start. */
export const COMMANDS = [
  { command: 'start', description: 'Buy a US stock' },
  { command: 'portfolio', description: 'My stocks' },
]
export const DESCRIPTION = 'Buy tokenized US stocks on BNB Chain safely. yostocks compares Ondo, xStocks and bStocks against the real stock price, blocks bad quotes, and buys from the best route through your Binance Agentic Wallet.'
export const SHORT_DESCRIPTION = 'Buy US stocks with USDT, only at the real price.'

export const ownerOnly = "🔒 This is a demo: only the owner's wallet can buy or sell. Tap any stock to see its price."
export const slowDown = () => '⏱ One moment, try again in a few seconds.'

/** Guarded comparison of every provider for one ticker (output of scan()). */
export function quoteCard({ ticker, usdt, ref, rows, best }, { ask = false, company } = {}) {
  const lines = [`<b>${esc(ticker)}</b>${company ? ` · ${esc(company)}` : ''} · quote for <b>${esc(usdt)} USDT</b>`, `Reference price <b>${usd(ref)}</b> / share`, '']
  const order = [...rows].sort((a, b) => (b === best) - (a === best) || b.ok - a.ok)
  for (const r of order) {
    const name = `${PROVIDER[r.t.type]} · ${esc(r.t.symbol)}`
    if (r === best) lines.push(`⭐ <b>${name}</b>`, `      ${usd(r.perShare)} / share · ${pct(r.dev)} · <i>best route</i>`)
    else if (r.ok) lines.push(`✅ ${name}`, `      ${usd(r.perShare)} / share · ${pct(r.dev)}`)
    else lines.push(`⛔ ${name}`, `      <i>${esc(r.why)}</i>`)
  }
  lines.push('')
  if (!best) lines.push('⛔ <b>No safe route right now.</b> Not trading.')
  else if (ask) lines.push(`You receive ≈ <b>${qty(best.got)} ${esc(best.t.symbol)}</b>`, '<i>Confirm within 60 seconds.</i>')
  else lines.push(`Best: ≈ <b>${qty(best.got)} ${esc(best.t.symbol)}</b> for ${esc(usdt)} USDT`)
  return lines.join('\n')
}

export const buttons = (id, usdt, symbol) => ({
  inline_keyboard: [[{ text: `✅ Swap ${usdt} USDT → ${symbol}`, callback_data: `buy:${id}` }, { text: 'Cancel', callback_data: `no:${id}` }]],
})

const sellWhy = (w = '') => (/market opening hours/i.test(w) ? 'This version can only be sold while the US stock market is open.' : /liquidity/i.test(w) ? 'Nobody is buying it on-chain right now.' : /off reference/.test(w) ? "The price offered is too far from the real stock price, so I won't sell." : /hold/.test(w) ? w : 'The sale is not available right now.')

/** Sell quote from scanSell(), in plain words. */
export function sellCard(s, { company } = {}) {
  const { ticker, row, qty: amount, usdtOut, ok, dev, why } = s
  const name = esc(nameOf(ticker, company))
  const n = shares(Number(amount) * row.multiplier)
  if (!ok) return [`⚠️ <b>Can't sell ${name} right now.</b>`, esc(sellWhy(why))].join('\n')
  return [`<b>Sell ${name}?</b>`, `${n} shares → about <b>${usd(usdtOut)}</b>`, `<i>That's ${vs(dev)}.</i>`].join('\n')
}
export const sellButtons = (id, usdtOut) => ({
  inline_keyboard: [[{ text: `✅ Sell for ~${usd(usdtOut)}`, callback_data: `sell:${id}` }, { text: 'Cancel', callback_data: `no:${id}` }]],
})

export function sellReceipt({ ticker, company, row, qty: amount, got, tx }) {
  return [
    `✅ <b>Sold!</b> You got <b>${usd(got)}</b>`,
    `for ${shares(Number(amount) * row.multiplier)} ${esc(nameOf(ticker, company))} shares.`,
    '',
    `<a href="${esc(tx)}">See the transaction ↗</a>`,
  ].join('\n')
}

export const submitting = (from, to, orderId) => `⏳ <b>Order submitted</b> · ${esc(from)} → ${esc(to)}\nConfirming on BNB Smart Chain… <code>${esc(orderId)}</code>`

/** Buy receipt. `ref` and `best` come from the scan() that was traded. */
export function receipt({ ticker, company, usdt, ref, best, got, tx }) {
  const sh = Number(got) * best.multiplier
  const avg = Number(usdt) / sh
  return [
    `✅ <b>Done! You bought ${esc(nameOf(ticker, company))}</b>`,
    '',
    `${shares(sh)} shares for <b>${usd(usdt)}</b>`,
    `<i>${usd(avg)} per share${ref ? `, ${vs((avg / ref - 1) * 100)}` : ''}.</i>`,
    '',
    `<a href="${esc(tx)}">See the transaction ↗</a>`,
  ].join('\n')
}

export const stillPending = (orderId) => `⏳ <b>Still confirming.</b>\nYour order went through but the network hasn't confirmed it yet. Check 💼 My stocks in a minute.\n<code>Order ${esc(orderId)}</code>`

export function problem(message) {
  if (/auth signin|SESSION_EXPIRED|NOT_LOGGED_IN/.test(message)) return '🔐 <b>Wallet session expired.</b>\nSign in again: <code>baw auth signin</code>'
  // x402 merchant said no before settling: the signed authorization was never executed, so no funds moved.
  const x402 = /rejected the paid request.*?(payment_rejected|settlement_failed)"?(?:,\s*"reason":\s*"([a-z_]+)")?/.exec(message)
  if (x402) return `⚠️ <b>Payment didn't go through, nothing was charged.</b>\nThe provider said: <code>${esc(x402[1])}${x402[2] ? ` (${esc(x402[2])})` : ''}</code>. You can try again.`
  return `⚠️ <b>Something went wrong</b>\n<code>${esc(message)}</code>`
}

export const notice = (text) => `ℹ️ ${esc(text)}`

// ---- analysis (BNB Agent Studio Stock Analyze Agent, paid over x402) ----
export const analysisOffer = (ticker, q, company) => [
  `🧠 <b>${esc(ticker)} research report</b>${company ? ` · ${esc(company)}` : ''}`,
  'By the BNB Agent Studio <b>Stock Analyze Agent</b>: rating, target price, fundamentals, technicals, risks.',
  '',
  `Price: <b>${Number(q.amount)} ${esc(q.token)}</b>, paid over x402 from your Agentic Wallet${q.approve ? ' (first time: one gas-free approval)' : ''}.`,
  '<i>Ready in 2–5 minutes. Confirm within 60 seconds.</i>',
].join('\n')
export const analystPaused = '⏸ <b>Payments to this agent are paused.</b> It currently rejects every x402 payment (<code>payment_rejected</code>) from Agentic Wallets; we\'ve reported it to BNB Chain. Try /market meanwhile.'
export const payButtons = (id, q) => ({ inline_keyboard: [[{ text: `💳 Pay ${Number(q.amount)} ${q.token}`, callback_data: `pay:${id}` }, { text: 'Cancel', callback_data: `no:${id}` }]] })
export const analysisPaid = (job) => `✅ <b>Paid ${esc(job.paid)}</b> over x402${job.txHash ? ` · <a href="https://bscscan.com/tx/${esc(job.txHash)}">tx ↗</a>` : ''}\n🧠 Analysing ${esc(job.ticker)}… I'll send the report here in 2–5 minutes.`
export function analysisReport(ticker, sum, company) {
  const lines = [`🧠 <b>${esc(ticker)} research report</b>${company ? ` · ${esc(company)}` : ''}`, '']
  if (sum.rating) lines.push(`<b>Rating:</b> ${esc(sum.rating.replace(/^.*?rating\s*:?\s*/i, ''))}`)
  if (sum.target) lines.push(`<b>Target price:</b> ${esc(sum.target.replace(/^.*?target\s*price\s*:?\s*/i, ''))}`)
  if (sum.risks.length) lines.push('', '<b>Key risks</b>', ...sum.risks.map((r) => `• ${esc(r.slice(0, 160))}`))
  lines.push('', '<i>Full report attached. Third-party analysis, not financial advice.</i>')
  return lines.join('\n')
}

// ---- market snapshot (CoinMarketCap MCP, paid over x402) ----
const big = (n) => (n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : usd(n))
export const marketOffer = (q) => [
  '🌍 <b>Crypto market snapshot</b> · CoinMarketCap',
  'Total market cap, 24h volume and change, BTC / ETH dominance: context before you trade.',
  '',
  `Price: <b>${Number(q.amount)} ${esc(q.token)}</b>, paid over x402 from your Agentic Wallet.`,
  '<i>Confirm within 60 seconds.</i>',
].join('\n')
export const marketButtons = (id, q) => ({ inline_keyboard: [[{ text: `💳 Pay ${Number(q.amount)} ${q.token}`, callback_data: `mkt:${id}` }, { text: 'Cancel', callback_data: `no:${id}` }]] })
const MOOD = [
  [24, '😱', 'Extreme fear: others are selling hard; prices are often cheap, but falling knives are real.'],
  [44, '😟', 'Fear: the crowd is cautious. Buying in small steps is usually safer than all at once.'],
  [55, '😐', 'Neutral: no strong crowd bias either way.'],
  [75, '😊', 'Greed: risk appetite is high. Avoid chasing; a fixed-size, scheduled buy beats FOMO.'],
  [100, '🤑', 'Extreme greed: the crowd is all-in. Pullbacks are more likely from here.'],
]
const chg = (n) => (n == null ? '' : ` (${pct(n)})`)

export function marketCard(r) {
  const x = r.snapshot
  const lines = ['🌍 <b>Crypto market now</b> · CoinMarketCap', '']
  if (x) {
    const mood = x.fearGreed && MOOD.find(([max]) => x.fearGreed.index <= max)
    if (x.fearGreed) lines.push(`${mood[1]} Sentiment: <b>${esc(x.fearGreed.label)}</b> (${x.fearGreed.index}/100)${x.fearGreed.lastWeek != null ? ` · last week ${x.fearGreed.lastWeek}` : ''}`)
    if (x.marketCap) lines.push(`💰 Market cap: <b>${esc(x.marketCap.value)}</b>${x.marketCap.d24 != null ? ` · ${pct(x.marketCap.d24)} today` : ''}${x.marketCap.d7 != null ? `, ${pct(x.marketCap.d7)} this week` : ''}`)
    if (x.volume24h) lines.push(`📊 24h volume: <b>${esc(x.volume24h.value)}</b>${chg(x.volume24h.d24)}`)
    if (x.btcDominance != null) lines.push(`₿ BTC dominance: <b>${x.btcDominance.toFixed(1)}%</b>${x.ethDominance != null ? ` · ETH ${x.ethDominance.toFixed(1)}%` : ''}`)
    if (x.altSeason) lines.push(`🔄 Altcoin season: <b>${x.altSeason.index}/100</b>${x.altSeason.yesterday != null ? ` (yesterday ${x.altSeason.yesterday})` : ''}`)
    if (x.openInterest) lines.push(`📈 Open interest: <b>${esc(x.openInterest.value)}</b>${chg(x.openInterest.d24)}`)
    if (mood) lines.push('', `<b>What it means:</b> ${esc(mood[2])}`)
    if (x.updated) lines.push('', `<i>Updated ${esc(x.updated)}</i>`)
  } else if (r.sections?.length) {
    for (const sec of r.sections) {
      lines.push(`<b>${esc(sec.title)}</b>`, ...sec.items.map((it) => `• ${esc(it.label)}: <b>${esc(it.current)}</b>${it.change24h ? ` (${esc(it.change24h)} 24h)` : ''}`), '')
    }
    lines.pop()
  } else {
    lines.push(r.partial ? '<i>Paid, but the provider closed the connection before sending the data.</i>' : '<i>The provider returned data in a format I could not read.</i>')
  }
  lines.push('', `✅ Paid <b>${esc(r.paid)}</b> over x402${r.flowId ? ` · <code>${esc(r.flowId.slice(0, 8))}</code>` : ''}`)
  return lines.join('\n')
}

// ---- macro calendar (macropulse via Bazaar, paid over x402) ----
const IMPACT = { high: '🔴', medium: '🟠', low: '⚪' }
export const macroOffer = (q) => [
  '🗓 <b>This week\'s market-moving events</b>',
  'CPI, jobs, GDP and central-bank decisions: the calendar that moves US stocks, before you buy them.',
  '',
  `Price: <b>${Number(q.amount)} ${esc(q.token)}</b>, paid over x402 from your Agentic Wallet (Bazaar merchant).`,
  '<i>Confirm within 60 seconds.</i>',
].join('\n')
export const macroButtons = (id, q) => ({ inline_keyboard: [[{ text: `💳 Pay ${Number(q.amount)} ${q.token}`, callback_data: `mac:${id}` }, { text: 'Cancel', callback_data: `no:${id}` }]] })
export function macroCard(r) {
  const lines = [`🗓 <b>Macro week${r.week ? ` of ${esc(r.week)}` : ''}</b>`, '']
  if (r.headline) lines.push(`<i>${esc(r.headline)}</i>`, '')
  for (const e of r.events) lines.push(`${IMPACT[e.impact] ?? '⚪'} ${esc(e.day ?? e.date)}${e.time ? ` ${esc(e.time)} UTC` : ''} · ${esc(e.event)}${e.currency && e.currency !== 'Multi' ? ` (${esc(e.currency)})` : ''}`)
  if (r.fed) lines.push('', `🏦 Fed: next decision <b>${esc(r.fed.next)}</b>${r.fed.rate && r.fed.rate !== 'Unknown' ? ` · rate ${esc(r.fed.rate)}` : ''}`)
  const usHigh = r.events.filter((e) => e.currency === 'USD' && e.impact === 'high')
  lines.push('', usHigh.length
    ? `<b>For US stocks:</b> ${usHigh.length} high-impact US release${usHigh.length > 1 ? 's' : ''} this week. Expect bigger swings around ${esc(usHigh[0].day)}; buying in smaller steps is safer.`
    : '<b>For US stocks:</b> no high-impact US releases this week; macro risk is low for scheduled buys.')
  if (r.partial) lines.push('<i>Paid, but the calendar came back unreadable.</i>')
  lines.push('', `✅ Paid <b>${esc(r.paid)}</b> over x402${r.tx ? ` · <a href="https://bscscan.com/tx/${esc(r.tx)}">tx ↗</a>` : ''}`)
  return lines.join('\n')
}

// ---- strategies ----
export const strategyCard = (description) => `🗓 <b>New strategy</b>\n\n${esc(description).replace(/\n· /g, '\n• ')}\n\n<i>Save it to run automatically.</i>`
export const strategyRejected = (errors) => `⚠️ <b>Can't save this strategy</b>\n${errors.map((e) => `• ${esc(e)}`).join('\n')}`
export const strategySaved = (id, description) => `💾 <b>Strategy saved</b> · <code>#${esc(id)}</code>\n\n${esc(description).replace(/\n· /g, '\n• ')}`
export const strategyList = (items) =>
  items.length
    ? `🗓 <b>Your strategies</b>\n\n${items.map(({ id, description }) => `<code>#${esc(id)}</code>\n${esc(description).replace(/\n· /g, '\n• ')}`).join('\n\n')}`
    : '🗓 No strategies yet. Try /strategy buy $10 of NVDA every Monday'
export const autopilot = (text) => `🤖 <b>Autopilot</b>\n${esc(text)}`
