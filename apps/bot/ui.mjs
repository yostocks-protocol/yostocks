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

<b>Autopilot</b>
/strategy buy $10 of NVDA every Monday, skip earnings
/strategies · your saved strategies
/stop &lt;id&gt; · remove one`

/** Telegram's command menu (setMyCommands) and the text shown before a user presses Start. */
export const COMMANDS = [
  { command: 'quote', description: 'Compare a stock across Ondo, xStocks, bStocks · /quote NVDA 10' },
  { command: 'buy', description: 'Buy from the safest, cheapest route · /buy NVDA 10' },
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

export const submitting = (usdt, symbol, orderId) => `⏳ <b>Order submitted</b> · ${esc(usdt)} USDT → ${esc(symbol)}\nConfirming on BNB Smart Chain… <code>${esc(orderId)}</code>`

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

// ---- strategies ----
export const strategyCard = (description) => `🗓 <b>New strategy</b>\n\n${esc(description).replace(/\n· /g, '\n• ')}\n\n<i>Save it to run automatically.</i>`
export const strategyRejected = (errors) => `⚠️ <b>Can't save this strategy</b>\n${errors.map((e) => `• ${esc(e)}`).join('\n')}`
export const strategySaved = (id, description) => `💾 <b>Strategy saved</b> · <code>#${esc(id)}</code>\n\n${esc(description).replace(/\n· /g, '\n• ')}`
export const strategyList = (items) =>
  items.length
    ? `🗓 <b>Your strategies</b>\n\n${items.map(({ id, description }) => `<code>#${esc(id)}</code>\n${esc(description).replace(/\n· /g, '\n• ')}`).join('\n\n')}`
    : '🗓 No strategies yet. Try /strategy buy $10 of NVDA every Monday'
export const autopilot = (text) => `🤖 <b>Autopilot</b>\n${esc(text)}`
