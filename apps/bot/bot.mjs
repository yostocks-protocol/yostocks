// yostocks Telegram bot: /quote, /buy and strategies on top of the guarded agent. Long polling.
import { realpathSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { scan, execute } from '../agent/yo.mjs'
import { parseStrategy, validate, describe } from './strategy.mjs'
import { runOnce } from './runner.mjs'
import * as ui from './ui.mjs'

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TG_API = process.env.TELEGRAM_API ?? 'https://api.telegram.org'
const OWNER = process.env.YO_OWNER_CHAT_ID // only this chat may use the wallet
const QUOTE_TTL = 60_000 // a Confirm button older than this re-quotes instead of trading
const DATA = process.env.YO_DATA ?? new URL('./data/strategies.json', import.meta.url).pathname

export const store = {
  load: () => { try { return JSON.parse(readFileSync(DATA, 'utf8')) } catch { return [] } },
  save: (list) => { mkdirSync(dirname(DATA), { recursive: true }); writeFileSync(DATA, JSON.stringify(list, null, 1)) },
}

export function parse(text = '') {
  const [cmd, ticker, amount] = text.trim().split(/\s+/)
  const name = cmd?.replace(/@.*$/, '').toLowerCase() // "/buy@yostocks_bot" in groups
  const usdt = Number(amount)
  if (!['/quote', '/buy'].includes(name)) return { cmd: name }
  if (!/^[A-Za-z.]{1,10}$/.test(ticker ?? '') || !(usdt > 0) || usdt > 1000) return { cmd: name, error: `usage: ${name} NVDA 10 (1–1000 USDT)` }
  return { cmd: name, ticker: ticker.toUpperCase(), usdt }
}

async function tg(method, body) {
  const res = await fetch(`${TG_API}/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const j = await res.json()
  if (!j.ok) throw new Error(`${method}: ${j.description}`)
  return j.result
}

export const brand = { logo: null } // file_id of the bot's own profile photo, found at startup
const say = (chat_id, html, extra = {}) => tg('sendMessage', { chat_id, text: html, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
// Cards carry a picture (the stock's logo, else the bot's); with neither they fall back to plain text.
const card = (chat_id, html, { photo = brand.logo, ...extra } = {}) =>
  photo ? tg('sendPhoto', { chat_id, photo, caption: html, parse_mode: 'HTML', ...extra }) : say(chat_id, html, extra)

const metaCache = new Map()
/** Stock logo URL + company name for a token from Binance RWA meta; null if unavailable. */
export async function stockMeta(token) {
  const a = token.contractAddress.toLowerCase()
  if (!metaCache.has(a)) {
    const m = await fetch(`https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/rwa/meta/ai?chainId=56&contractAddress=${a}`, {
      headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'binance-web3/1.1 (Skill)' },
    }).then((r) => r.json()).then((j) => j.data).catch(() => null)
    metaCache.set(a, m?.icon ? { photo: `https://bin.bnbstatic.com${m.icon}`, company: m.companyInfo?.companyName } : null)
  }
  return metaCache.get(a)
}

// ponytail: in-memory, pending confirmations are lost on restart; fine while one owner uses one process
const pending = new Map()

export async function onMessage(msg) {
  const chat = msg.chat.id
  if (String(chat) !== OWNER) return say(chat, ui.privateBot(chat))
  const [head, ...rest] = (msg.text ?? '').trim().split(/\s+/)
  const name = head?.replace(/@.*$/, '').toLowerCase()
  if (name === '/strategy') return onStrategy(chat, rest.join(' '))
  if (name === '/strategies') return say(chat, ui.strategyList(store.load().map((s) => ({ id: s.id, description: describe(s.rule) }))))
  if (name === '/stop') {
    const list = store.load()
    const keep = list.filter((s) => s.id !== rest[0])
    store.save(keep)
    return say(chat, ui.notice(keep.length < list.length ? `Stopped strategy #${rest[0]}.` : `No strategy #${rest[0] ?? ''}.`))
  }
  const p = parse(msg.text)
  if (p.error) return say(chat, ui.notice(p.error))
  if (!p.ticker) return card(chat, ui.HELP)

  const s = await scan(p.ticker, p.usdt)
  const m = await stockMeta((s.best ?? s.rows[0]).t)
  const photo = m?.photo ?? brand.logo
  if (p.cmd === '/quote' || !s.best) return card(chat, ui.quoteCard(s, { company: m?.company }), { photo })
  const id = Math.random().toString(36).slice(2, 10)
  pending.set(id, { ...p, at: Date.now() })
  await card(chat, ui.quoteCard(s, { ask: true, company: m?.company }), { photo, reply_markup: ui.buttons(id, p.usdt, s.best.t.symbol) })
}

async function onStrategy(chat, text) {
  if (!text) return say(chat, ui.notice('usage: /strategy buy $10 of NVDA every Monday 9pm, skip earnings weeks'))
  const rule = await parseStrategy(text)
  const errors = validate(rule)
  if (errors.length) return say(chat, ui.strategyRejected(errors))
  const id = Math.random().toString(36).slice(2, 8)
  pending.set(id, { rule, at: Date.now() })
  return say(chat, ui.strategyCard(describe(rule)), {
    reply_markup: { inline_keyboard: [[{ text: '💾 Save', callback_data: `save:${id}` }, { text: 'Cancel', callback_data: `no:${id}` }]] },
  })
}

export async function onCallback(q) {
  const chat = q.message.chat.id
  const [action, id] = q.data.split(':')
  const p = pending.get(id)
  pending.delete(id) // one tap = one decision, even on double-tap
  await tg('answerCallbackQuery', { callback_query_id: q.id })
  await tg('editMessageReplyMarkup', { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } })
  if (String(chat) !== OWNER || !p || action === 'no') return say(chat, ui.notice(p ? 'Cancelled.' : 'This button has expired. Send /buy again.'))
  if (action === 'save' && p.rule) {
    store.save([...store.load(), { id, chat, rule: p.rule, createdAt: new Date().toISOString() }])
    return say(chat, ui.strategySaved(id, describe(p.rule)))
  }
  if (action !== 'buy' || !p.ticker) return say(chat, ui.notice('This button has expired. Send /buy again.'))
  if (Date.now() - p.at > QUOTE_TTL) return say(chat, ui.notice('This quote is older than 60 seconds. Send /buy again for a fresh one.'))

  // Re-run the guard right before trading: the quote the user saw may have moved.
  const s = await scan(p.ticker, p.usdt)
  if (!s.best) return say(chat, ui.quoteCard(s))
  const r = await execute(s.best.t, p.usdt, (orderId) => say(chat, ui.submitting(p.usdt, s.best.t.symbol, orderId)))
  if (r.status !== 'FINISHED') return say(chat, ui.stillPending(r.orderId))
  const m = await stockMeta(s.best.t)
  return card(chat, ui.receipt({ ticker: p.ticker, company: m?.company, usdt: p.usdt, ref: s.ref, best: s.best, got: r.got ?? s.best.got, tx: r.tx, orderId: r.orderId }), { photo: m?.photo ?? brand.logo })
}

async function main() {
  if (!TOKEN) throw new Error('set TELEGRAM_BOT_TOKEN')
  const me = await tg('getMe', {})
  await Promise.all([
    tg('setMyCommands', { commands: ui.COMMANDS }),
    tg('setMyDescription', { description: ui.DESCRIPTION }),
    tg('setMyShortDescription', { short_description: ui.SHORT_DESCRIPTION }),
    tg('setChatMenuButton', { menu_button: { type: 'commands' } }),
  ]).catch((e) => console.error('menu setup', e.message))
  const photos = await tg('getUserProfilePhotos', { user_id: me.id, limit: 1 }).catch(() => null)
  brand.logo = photos?.photos?.[0]?.at(-1)?.file_id ?? null // largest size of the current avatar
  console.log(`@${me.username} running, owner chat ${OWNER ?? '(unset: send /start to get your id)'}, logo ${brand.logo ? 'yes' : 'no'}`)
  let running = false // one runner pass at a time; a slow swap must not start a second one
  setInterval(async () => {
    if (running) return
    running = true
    try {
      const done = await runOnce({ store, scan, execute, say: (chat, text) => say(chat, ui.autopilot(text)) })
      if (Object.keys(done).length) console.log('runner', JSON.stringify(done))
    } catch (e) {
      console.error('runner', e)
    } finally {
      running = false
    }
  }, 60_000)
  for (let offset = 0; ;) {
    const updates = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }).catch((e) => {
      console.error(e.message)
      return new Promise((r) => setTimeout(() => r([]), 5000))
    })
    for (const u of updates) {
      offset = u.update_id + 1
      const chat = u.message?.chat.id ?? u.callback_query?.message.chat.id
      const job = u.message?.text ? onMessage(u.message) : u.callback_query ? onCallback(u.callback_query) : null
      job?.catch((e) => { console.error(e); say(chat, ui.problem(e.message)).catch(() => {}) })
    }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) main()
