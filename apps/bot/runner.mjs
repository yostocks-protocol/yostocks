// Runs saved strategies on schedule. Every run goes through the same guard as /buy, plus the
// rule's own conditions and a daily spend cap across all strategies. Saving a rule is the consent;
// the cap is the brake.
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] // Date#getUTCDay order
export const GRACE_MS = 2 * 60 * 60 * 1000 // run late up to 2h (bot was down), then count it as missed
export const DAILY_CAP = Number(process.env.YO_DAILY_CAP ?? 50) // USDT per chat (= per wallet) across its strategies, per UTC day

/** Start (ms) of the most recent scheduled slot at or before `now`. */
export function lastSlot(rule, now) {
  const d = new Date(now)
  const slot = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), rule.hourUtc)
  if (rule.every === 'day') return slot <= now ? slot : slot - 86_400_000
  const back = (d.getUTCDay() - DAYS.indexOf(rule.weekday) + 7) % 7
  const s = slot - back * 86_400_000
  return s <= now ? s : s - 7 * 86_400_000
}

/** 'run' | 'missed' | null for a stored strategy at `now`. */
export function due(s, now) {
  const slot = lastSlot(s.rule, now)
  if (slot <= Date.parse(s.lastSlot ?? s.createdAt)) return null // already handled, or saved after this slot
  return now - slot <= GRACE_MS ? 'run' : 'missed'
}

const spentToday = (list, now) => {
  const day = new Date(now).toISOString().slice(0, 10)
  return list
    .flatMap((s) => s.runs ?? [])
    .filter((r) => ['FINISHED', 'PENDING'].includes(r.status) && r.at.startsWith(day)) // pending may still fill
    .reduce((a, r) => a + r.usdt, 0)
}

/**
 * One pass over all strategies. deps: { store, scan, execute, say, now, inWallet?, canTrade? }.
 * inWallet(chat, fn) runs fn against that chat's wallet session; canTrade(chat) is false once it disconnected.
 * Returns what happened per strategy id, for logs/tests.
 */
export async function runOnce({ store, scan, execute, say, now = Date.now(), inWallet = (chat, fn) => fn(), canTrade = () => true }) {
  const out = {}
  for (const s of store.load()) {
    const state = due(s, now)
    if (!state) continue
    const slot = new Date(lastSlot(s.rule, now)).toISOString()
    let result
    try {
      result = state === 'missed' ? { status: 'SKIPPED', why: 'missed its slot by more than 2h' }
        : !canTrade(s.chat) ? { status: 'SKIPPED', why: 'wallet not connected' }
        : await inWallet(s.chat, () => attempt(s, now, { store, scan, execute }))
    } catch (e) {
      result = { status: 'ERROR', why: /SESSION_EXPIRED|NOT_LOGGED_IN/.test(e.message) ? 'connect Binance again in the bot' : e.message }
    }
    // Persist before notifying: a crash after this line can't re-run the same slot.
    const list = store.load()
    const cur = list.find((x) => x.id === s.id)
    if (cur) {
      cur.lastSlot = slot
      cur.runs = [...(cur.runs ?? []), { at: new Date(now).toISOString(), usdt: s.rule.usdt, ...result }].slice(-20)
      store.save(list)
    }
    out[s.id] = result
    const what = `$${s.rule.usdt} of ${s.rule.ticker}`
    await say(s.chat, result.status === 'FINISHED' ? `✅ Bought ${what} (${result.symbol})\n${result.tx}`
      : result.status === 'ERROR' ? `✗ Couldn't buy ${what}: ${result.why}` : `⏭ Skipped ${what}: ${result.why}`).catch(() => {})
  }
  return out
}

async function attempt(s, now, { store, scan, execute }) {
  const r = s.rule
  const spent = spentToday(store.load().filter((x) => x.chat === s.chat), now) // each wallet has its own cap
  if (spent + r.usdt > DAILY_CAP) return { status: 'SKIPPED', why: `daily cap ${DAILY_CAP} USDT reached (spent ${spent})` }

  const q = await scan(r.ticker, r.usdt)
  if (r.skipEarnings) {
    const e = q.rows.find((x) => x.status?.reasonCode === 'ASSET_LIMITED' && x.status?.reasonMsg === 'earnings')
    if (e) return { status: 'SKIPPED', why: `earnings limits active on ${e.t.symbol}` }
  }
  if (!q.best) return { status: 'SKIPPED', why: 'no safe route' }
  if (r.maxPremiumPct != null && q.best.dev > r.maxPremiumPct) return { status: 'SKIPPED', why: `best premium ${q.best.dev.toFixed(2)}% > ${r.maxPremiumPct}%` }

  const x = await execute(q.best.t, r.usdt)
  if (x.status !== 'FINISHED') return { status: 'PENDING', why: `order ${x.orderId} still pending` }
  return { status: 'FINISHED', symbol: q.best.t.symbol, tx: x.tx, perShare: q.best.perShare }
}

