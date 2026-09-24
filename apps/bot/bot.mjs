// yostocks Telegram bot: /quote and /buy on top of the guarded agent. Long polling, no dependencies.
import { realpathSync } from 'node:fs'
import { scan, format, execute } from '../agent/yo.mjs'

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const OWNER = process.env.YO_OWNER_CHAT_ID // only this chat may use the wallet
const QUOTE_TTL = 60_000 // a Confirm button older than this re-quotes instead of trading

export function parse(text = '') {
  const [cmd, ticker, amount] = text.trim().split(/\s+/)
  const name = cmd?.replace(/@.*$/, '').toLowerCase() // "/buy@yostocks_bot" in groups
  const usdt = Number(amount)
  if (!['/quote', '/buy'].includes(name)) return { cmd: name }
  if (!/^[A-Za-z.]{1,10}$/.test(ticker ?? '') || !(usdt > 0) || usdt > 1000) return { cmd: name, error: `usage: ${name} NVDA 10 (1–1000 USDT)` }
  return { cmd: name, ticker: ticker.toUpperCase(), usdt }
}

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const j = await res.json()
  if (!j.ok) throw new Error(`${method}: ${j.description}`)
  return j.result
}

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const say = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text: `<pre>${esc(text)}</pre>`, parse_mode: 'HTML', ...extra })

// ponytail: in-memory, pending confirmations are lost on restart; fine while one owner uses one process
const pending = new Map()

async function onMessage(msg) {
  const chat = msg.chat.id
  if (String(chat) !== OWNER) return say(chat, `yostocks is private. Your chat id: ${chat}\nSet YO_OWNER_CHAT_ID=${chat} to use it.`)
  const p = parse(msg.text)
  if (p.error) return say(chat, p.error)
  if (!p.ticker) return say(chat, 'yo 👋\n/quote NVDA 10  compare Ondo · xStocks · bStocks\n/buy NVDA 10    buy from the best safe route')

  const s = await scan(p.ticker, p.usdt)
  if (p.cmd === '/quote' || !s.best) return say(chat, format(s))
  const id = Math.random().toString(36).slice(2, 10)
  pending.set(id, { ...p, at: Date.now() })
  await say(chat, `${format(s)}\n\nswap ${p.usdt} USDT → ${s.best.t.symbol}?`, {
    reply_markup: { inline_keyboard: [[{ text: '✅ Confirm', callback_data: `buy:${id}` }, { text: 'Cancel', callback_data: `no:${id}` }]] },
  })
}

async function onCallback(q) {
  const chat = q.message.chat.id
  const [action, id] = q.data.split(':')
  const p = pending.get(id)
  pending.delete(id) // one tap = one decision, even on double-tap
  await tg('answerCallbackQuery', { callback_query_id: q.id })
  await tg('editMessageReplyMarkup', { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } })
  if (String(chat) !== OWNER || !p || action !== 'buy') return say(chat, p ? 'cancelled' : 'expired, send /buy again')
  if (Date.now() - p.at > QUOTE_TTL) return say(chat, 'quote is older than 60s, send /buy again')

  // Re-run the guard right before trading: the quote the user saw may have moved.
  const s = await scan(p.ticker, p.usdt)
  if (!s.best) return say(chat, format(s))
  const r = await execute(s.best.t, p.usdt, (orderId) => say(chat, `submitted ${s.best.t.symbol} order ${orderId}, confirming…`))
  return say(chat, r.status === 'FINISHED' ? `✓ filled ${s.best.t.symbol}\n${r.tx}` : `still pending: order ${r.orderId}`)
}

async function main() {
  if (!TOKEN) throw new Error('set TELEGRAM_BOT_TOKEN')
  const me = await tg('getMe', {})
  console.log(`@${me.username} running, owner chat ${OWNER ?? '(unset: send /start to get your id)'}`)
  for (let offset = 0; ;) {
    const updates = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }).catch((e) => {
      console.error(e.message)
      return new Promise((r) => setTimeout(() => r([]), 5000))
    })
    for (const u of updates) {
      offset = u.update_id + 1
      const chat = u.message?.chat.id ?? u.callback_query?.message.chat.id
      const job = u.message?.text ? onMessage(u.message) : u.callback_query ? onCallback(u.callback_query) : null
      job?.catch((e) => { console.error(e); say(chat, `✗ ${e.message}`).catch(() => {}) })
    }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) main()
