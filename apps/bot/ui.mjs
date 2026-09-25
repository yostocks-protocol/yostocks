// Telegram message templates (HTML parse mode). Pure functions: data in, HTML string out.
const PROVIDER = { 1: 'Ondo', 2: 'xStocks', 3: 'bStocks' }

export const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const usd = (n) => `$${Number(n).toFixed(2)}`
const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`
const qty = (n) => Number(n).toFixed(6)

export const HELP = `<b>yostocks</b> · tokenized US stocks on BNB Chain, with a safety check on every trade.

<b>Trade</b>
/quote NVDA 10 · compare Ondo, xStocks and bStocks
/buy NVDA 10 · buy from the safest, cheapest route
/sell NVDA · sell what you hold (or /sell NVDA 0.01)
/analyze NVDA · research report from BNB Agent Studio, paid via x402
/macro · this week's CPI / jobs / Fed calendar, paid via x402

<b>Autopilot</b>
/strategy buy $10 of NVDA every Monday, skip earnings
/strategies · your saved strategies
/stop &lt;id&gt; · remove one`

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
export const doneButtons = { inline_keyboard: [[mine$, home$]] }

export const home = (owner) => [
  '👋 <b>Buy US stocks with USDT</b>',
  'Pick one, or type any ticker (like <code>AMD</code>).',
  'I only buy when the price matches the real stock price.',
  ...(owner ? [] : ['', '<i>Demo: you can look around; only the owner can buy.</i>']),
].join('\n')
export const homeButtons = (owner) => ({
  inline_keyboard: [
    ...rows(TICKERS.map((t) => ({ text: NAMES[t], callback_data: `stk:${t}` })), 2),
    ...(owner ? [[mine$]] : []),
  ],
})
export const askTicker = '🔎 Type a ticker, for example <code>AMD</code>.'

/** One stock, in plain words. The provider comparison lives behind "Why?". */
export function stockCard({ ticker, ref, best }, { company, owner } = {}) {
  const lines = [`<b>${esc(nameOf(ticker, company))}</b> (${esc(ticker)})`, `<b>${usd(ref)}</b> per share`, '']
  if (!best) {
    lines.push('⚠️ <b>Not a good time to buy.</b>', "On-chain prices don't match the real price right now. Try again in a bit.")
  } else {
    lines.push('✅ <b>Good price right now</b>', `<i>Cheapest safe option: ${PROVIDER[best.t.type]}, ${vs(best.dev)}.</i>`)
    if (owner) lines.push('', 'How much do you want to buy?')
  }
  return lines.join('\n')
}
export const stockButtons = (id, ticker, canBuy) => ({
  inline_keyboard: [
    ...(canBuy ? [AMOUNTS.map((a) => ({ text: `Buy $${a}`, callback_data: `b:${id}:${a}` }))] : []),
    [{ text: 'ℹ️ Why?', callback_data: `why:${ticker}` }, home$],
  ],
})
export const whyButtons = (ticker) => ({ inline_keyboard: [[{ text: '← Back', callback_data: `stk:${ticker}` }, home$]] })

export function portfolio(items) {
  if (!items.length) return "💼 You don't own any stocks yet. Pick one to start:"
  const total = items.reduce((a, h) => a + h.usd, 0)
  return [
    `💼 <b>Your stocks</b> · ${usd(total)}`,
    '',
    ...items.map((h) => `<b>${esc(nameOf(h.t.ticker))}</b> · ${shares(Number(h.qty) * Number(h.t.multiplier || 1))} shares · ${usd(h.usd)}`),
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

export const PUBLIC_HELP = `<b>yostocks</b> · tokenized US stocks on BNB Chain, with a safety check on every trade.

You're in <b>demo mode</b>: try it on live mainnet data.
/quote NVDA 10 · compare Ondo, xStocks and bStocks against the real stock price
/analyze NVDA · see the x402 research offer from BNB Agent Studio
/macro · see the x402 macro-calendar offer

Buying, selling and strategies run on the owner's wallet only.`
export const ownerOnly = "🔒 This is a demo: only the owner's wallet can buy or sell. Tap any stock to see its price."
export const slowDown = (s) => `⏱ One price check every ${s} seconds in demo mode, please.`

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
