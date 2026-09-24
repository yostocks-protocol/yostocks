// This week's high-impact economic calendar (CPI, NFP, FOMC, central banks) from the macropulse
// Bazaar merchant, paid per call over x402 in USD1. What moves US stocks, before you buy them.
import { writeFileSync, mkdirSync } from 'node:fs'
import { challenge, payAndSend, readAll, rejection, decode } from './x402.mjs'

export const MACRO = process.env.YO_MACRO_URL ?? 'https://macropulse.theaslangroupllc.com/api/calendar'
export const lastPrice = { amount: '0.1', token: 'USD1' }

export async function quote() {
  const ch = await challenge(MACRO, { method: 'GET', headers: {} })
  Object.assign(lastPrice, { amount: String(Number(ch.amount)), token: ch.token })
  return ch
}

export async function buy(ch) {
  const res = await payAndSend(ch)
  const text = await readAll(res)
  if (res.status !== 200) throw rejection(ch, res, text)
  const settlement = decode(res.headers.get('payment-response'))
  let raw = null
  try { raw = JSON.parse(text) } catch {}
  try {
    mkdirSync(new URL('./data/', import.meta.url), { recursive: true })
    writeFileSync(new URL('./data/macro-last.json', import.meta.url), text)
  } catch {}
  return { ...digest(raw), tx: settlement?.transaction || null, paid: `${Number(ch.amount)} ${ch.token}`, partial: raw == null }
}

const RANK = { high: 0, medium: 1, low: 2 }
/** What a US-stock buyer needs: headline, USD / high-impact events, the Fed. */
export function digest(raw) {
  if (!raw?.events) return { week: null, headline: null, events: [], fed: null }
  const events = raw.events
    .filter((e) => e.impact === 'high' || e.currency === 'USD')
    .sort((a, b) => a.date.localeCompare(b.date) || (RANK[a.impact] ?? 3) - (RANK[b.impact] ?? 3))
    .slice(0, 6)
    .map((e) => ({ date: e.date, day: e.day, time: e.time_utc, event: e.event, currency: e.currency, impact: e.impact, consensus: e.consensus, previous: e.previous }))
  const fed = raw.central_banks?.find((b) => /federal reserve|fomc|\bfed\b/i.test(b.bank)) ?? null
  return { week: raw.week_of ?? null, headline: raw.headline ?? null, events, fed: fed && { next: fed.next_decision, rate: fed.current_rate } }
}
