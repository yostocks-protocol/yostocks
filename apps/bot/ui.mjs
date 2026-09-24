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

<b>Autopilot</b>
/strategy buy $10 of NVDA every Monday, skip earnings
/strategies · your saved strategies
/stop &lt;id&gt; · remove one`

/** Telegram's command menu (setMyCommands) and the text shown before a user presses Start. */
export const COMMANDS = [
  { command: 'quote', description: 'Compare a stock across Ondo, xStocks, bStocks · /quote NVDA 10' },
  { command: 'buy', description: 'Buy from the safest, cheapest route · /buy NVDA 10' },
  { command: 'sell', description: 'Sell a stock you hold for USDT · /sell NVDA' },
  { command: 'analyze', description: 'Research report by BNB Agent Studio, paid via x402 · /analyze NVDA' },
  { command: 'strategy', description: 'Automate in plain English · /strategy buy $10 of NVDA every Monday' },
  { command: 'strategies', description: 'Your saved strategies' },
  { command: 'stop', description: 'Remove a strategy · /stop <id>' },
  { command: 'start', description: 'How yostocks works' },
]
export const DESCRIPTION = 'Buy tokenized US stocks on BNB Chain safely. yostocks compares Ondo, xStocks and bStocks against the real stock price, blocks bad quotes, and buys from the best route through your Binance Agentic Wallet.'
export const SHORT_DESCRIPTION = 'Tokenized US stocks on BNB Chain, with a safety check on every trade.'

export const privateBot = (chat) => `🔒 <b>yostocks is private.</b>\nYour chat id is <code>${esc(chat)}</code>. Set <code>YO_OWNER_CHAT_ID=${esc(chat)}</code> to use it.`

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

/** Sell quote from scanSell(). */
export function sellCard(s, { ask = false, company } = {}) {
  const { ticker, ref, row, qty: amount, usdtOut, ok, perShare, dev, why } = s
  const lines = [
    `<b>${esc(ticker)}</b>${company ? ` · ${esc(company)}` : ''} · sell`,
    `Selling <b>${qty(amount)} ${esc(row.t.symbol)}</b> (${PROVIDER[row.t.type]})`,
    `Reference price <b>${usd(ref)}</b> / share`,
    '',
  ]
  if (!ok) lines.push(`⛔ <b>Not selling.</b> <i>${esc(why)}</i>`)
  else {
    lines.push(`✅ Sell price <b>${usd(perShare)}</b> / share · ${pct(dev)}`, `You receive ≈ <b>${Number(usdtOut).toFixed(4)} USDT</b>`)
    if (ask) lines.push('<i>Confirm within 60 seconds.</i>')
  }
  return lines.join('\n')
}

export const sellButtons = (id, amount, symbol) => ({
  inline_keyboard: [[{ text: `✅ Sell ${qty(amount)} ${symbol} → USDT`, callback_data: `sell:${id}` }, { text: 'Cancel', callback_data: `no:${id}` }]],
})

export function sellReceipt({ ticker, company, row, qty: amount, ref, got, tx, orderId }) {
  const avg = Number(got) / (Number(amount) * row.multiplier)
  return [
    '✅ <b>Sold</b>',
    '',
    `<b>${Number(got).toFixed(4)} USDT</b> for ${qty(amount)} ${esc(row.t.symbol)}`,
    `${company ? `${esc(company)} (${esc(ticker)})` : esc(ticker)} on ${PROVIDER[row.t.type]}`,
    `Avg price: <b>${usd(avg)}</b> / share (${pct((avg / ref - 1) * 100)} vs ${esc(ticker)})`,
    'Network: BNB Smart Chain',
    '',
    `<a href="${esc(tx)}">View on BscScan ↗</a>`,
    `<code>Order ${esc(orderId)}</code>`,
  ].join('\n')
}

export const submitting = (from, to, orderId) => `⏳ <b>Order submitted</b> · ${esc(from)} → ${esc(to)}\nConfirming on BNB Smart Chain… <code>${esc(orderId)}</code>`

/** Caption for the filled-order receipt. `ref` and `best` come from the scan() that was traded. */
export function receipt({ ticker, company, usdt, ref, best, got, tx, orderId }) {
  const avg = Number(usdt) / (Number(got) * best.multiplier)
  const vsRef = ref ? (avg / ref - 1) * 100 : null
  return [
    '✅ <b>Order filled</b>',
    '',
    `<b>${qty(got)} ${esc(best.t.symbol)}</b> · ${company ? `${esc(company)} (${esc(ticker)})` : esc(ticker)} on ${PROVIDER[best.t.type]}`,
    `Paid: <b>${Number(usdt).toFixed(2)} USDT</b>`,
    `Avg price: <b>${usd(avg)}</b> / share${vsRef != null ? ` (${pct(vsRef)} vs ${esc(ticker)})` : ''}`,
    'Network: BNB Smart Chain',
    '',
    `<a href="${esc(tx)}">View on BscScan ↗</a>`,
    `<code>Order ${esc(orderId)}</code>`,
  ].join('\n')
}

export const stillPending = (orderId) => `⏳ <b>Still confirming.</b>\nThe order is submitted but not confirmed yet. It will show on BscScan shortly.\n<code>Order ${esc(orderId)}</code>`

export function problem(message) {
  if (/auth signin|SESSION_EXPIRED|NOT_LOGGED_IN/.test(message)) return '🔐 <b>Wallet session expired.</b>\nSign in again: <code>baw auth signin</code>'
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

// ---- strategies ----
export const strategyCard = (description) => `🗓 <b>New strategy</b>\n\n${esc(description).replace(/\n· /g, '\n• ')}\n\n<i>Save it to run automatically.</i>`
export const strategyRejected = (errors) => `⚠️ <b>Can't save this strategy</b>\n${errors.map((e) => `• ${esc(e)}`).join('\n')}`
export const strategySaved = (id, description) => `💾 <b>Strategy saved</b> · <code>#${esc(id)}</code>\n\n${esc(description).replace(/\n· /g, '\n• ')}`
export const strategyList = (items) =>
  items.length
    ? `🗓 <b>Your strategies</b>\n\n${items.map(({ id, description }) => `<code>#${esc(id)}</code>\n${esc(description).replace(/\n· /g, '\n• ')}`).join('\n\n')}`
    : '🗓 No strategies yet. Try /strategy buy $10 of NVDA every Monday'
export const autopilot = (text) => `🤖 <b>Autopilot</b>\n${esc(text)}`
