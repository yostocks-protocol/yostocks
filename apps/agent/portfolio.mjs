// Profit and loss for tokenized stocks bought through the Agentic Wallet.
// Cost basis comes from the wallet's own finished market orders (average-cost method);
// current value from the wallet balance; the history chart from Binance's token K-lines.
import { baw, holdings } from './yo.mjs'

const API = 'https://www.binance.com/bapi/defi'
const HEADERS = { 'Accept-Encoding': 'identity', 'User-Agent': 'binance-web3/1.1 (Skill)' }
export const QUICKCHART = process.env.YO_QUICKCHART ?? 'https://quickchart.io'
// USD stables the agent pays with; everything else in an order is treated as the stock side.
const STABLES = new Set([
  '0x55d398326f99059ff775485246999027b3197955', // USDT
  '0xce24439f2d9c6a2289f741120fe202248b666666', // U
  '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d', // USD1
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
])
const lc = (a) => String(a ?? '').toLowerCase()

/** Finished BSC market orders, oldest first. */
// ponytail: newest 100 only; past that the oldest buys drop out of the cost basis. Page with --page if a wallet gets there.
export async function orders() {
  const r = await baw('market-order', 'list', '--binanceChainId', '56', '--status', 'FINISHED', '--pageSize', '100')
  if (!r.success) throw new Error(`order history failed: ${JSON.stringify(r.error)}`)
  return [...r.data.list].sort((a, b) => Date.parse(a.bookTime) - Date.parse(b.bookTime))
}

/**
 * Average-cost ledger. Buys (stable → stock) add quantity and cost; sells (stock → stable) remove
 * quantity at average cost and book the difference as realized PnL. Pure, so it's testable.
 * Returns { byToken: { addr: { qty, cost, realized } }, events: [{ at, token, qty, cost, realized }] }
 */
export function ledger(list, isStock) {
  const byToken = {}
  const events = []
  for (const o of list) {
    const from = lc(o.fromToken)
    const to = lc(o.toToken)
    const at = Date.parse(o.bookTime)
    if (STABLES.has(from) && isStock(to)) {
      const p = (byToken[to] ??= { qty: 0, cost: 0, realized: 0 })
      p.qty += Number(o.toTokenActualQty)
      p.cost += Number(o.fromTokenQty)
      events.push({ at, token: to, ...p })
    } else if (isStock(from) && STABLES.has(to)) {
      const p = (byToken[from] ??= { qty: 0, cost: 0, realized: 0 })
      const sold = Math.min(Number(o.fromTokenQty), p.qty)
      const avg = p.qty > 0 ? p.cost / p.qty : 0
      p.realized += Number(o.toTokenActualQty) - avg * sold
      p.cost -= avg * sold
      p.qty -= sold
      if (p.qty < 1e-12) { p.qty = 0; p.cost = 0 }
      events.push({ at, token: from, ...p })
    }
  }
  return { byToken, events }
}

/** Current positions with value, cost and PnL (unrealized on what's held + realized from sells). */
export async function summary() {
  const [held, list] = await Promise.all([holdings(), orders().catch(() => [])]) // no history → no PnL, still show holdings
  // ponytail: anything that isn't a USD stable counts as a stock; fine while the agent only trades stocks
  const { byToken, events } = ledger(list, (a) => !STABLES.has(a))
  const rows = held.map((h) => {
    const l = byToken[lc(h.t.contractAddress)]
    // Balance can differ from the ledger (transfers); cost is scaled to what is actually held.
    const cost = l?.qty > 0 ? l.cost * Math.min(Number(h.qty) / l.qty, 1) : null
    return { ...h, cost, pnl: cost == null ? null : h.usd - cost }
  })
  const sum = (xs) => xs.reduce((a, x) => a + (x ?? 0), 0)
  const realized = sum(Object.values(byToken).map((p) => p.realized))
  const cost = sum(rows.map((r) => r.cost))
  const unrealized = sum(rows.map((r) => r.pnl))
  return { rows, value: sum(rows.map((r) => r.usd)), cost, unrealized, realized, total: unrealized + realized, events }
}

/** Close prices for a token: [[openTimeMs, close]]. */
export async function klines(token, interval, limit = 300) {
  const url = `${API}/v1/public/wallet-direct/buw/wallet/dex/market/token/kline/ai?chainId=56&contractAddress=${token}&interval=${interval}&limit=${limit}`
  const j = await (await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) })).json()
  if (!j.success) throw new Error(`kline ${token}: ${j.code}`)
  return j.data.klineInfos.map((k) => [Number(k[0]), Number(k[4])])
}

/** Pick a candle size that covers `spanMs` in at most 300 candles. */
export const intervalFor = (spanMs) => (spanMs <= 12 * 864e5 ? ['1h', 36e5] : spanMs <= 50 * 864e5 ? ['4h', 144e5] : ['1d', 864e5])

/**
 * PnL over time: at each candle, sum over tokens of qty(t) × close(t) − cost(t) + realized(t),
 * where qty/cost/realized come from the last ledger event at or before t. Pure.
 */
export function pnlSeries(events, prices, now = Date.now()) {
  if (!events.length) return []
  const start = events[0].at
  const times = [...new Set(Object.values(prices).flat().map(([t]) => t))].filter((t) => t >= start - 36e5 && t <= now).sort((a, b) => a - b)
  const last = (list, t) => { let v = null; for (const x of list) { if (x[0] <= t) v = x[1]; else break } return v }
  const byToken = {}
  for (const e of events) (byToken[e.token] ??= []).push(e)
  return times.map((t) => {
    let pnl = 0
    for (const [token, evs] of Object.entries(byToken)) {
      const e = evs.findLast((x) => x.at <= t) // position held when this candle opened
      if (!e) continue
      const px = last(prices[token] ?? [], t)
      pnl += (px != null ? e.qty * px : 0) - e.cost + e.realized
    }
    return { t, pnl }
  })
}

/** Render the series as a PNG via QuickChart; returns an image URL Telegram can fetch, or null. */
export async function chartUrl(series) {
  if (series.length < 2) return null
  const fmt = (t) => new Date(t).toISOString().slice(5, 16).replace('T', ' ')
  const up = series.at(-1).pnl >= 0
  const chart = {
    type: 'line',
    data: {
      labels: series.map((p) => fmt(p.t)),
      datasets: [{
        data: series.map((p) => Number(p.pnl.toFixed(4))),
        borderColor: up ? '#3ecf8e' : '#ff6b6b',
        backgroundColor: up ? 'rgba(62,207,142,0.18)' : 'rgba(255,107,107,0.18)',
        fill: 'origin', pointRadius: 0, borderWidth: 2, tension: 0.25,
      }],
    },
    options: {
      plugins: { legend: { display: false }, title: { display: true, text: 'Profit / loss in USD (times in UTC)', color: '#f0f0f5', font: { size: 16 } } },
      scales: {
        x: { ticks: { color: '#8888a8', maxTicksLimit: 6 }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#8888a8' }, grid: { color: 'rgba(255,255,255,0.08)' } },
      },
    },
  }
  return render(chart, 800, 420)
}

/** PNG URL for a Chart.js config (object, or a JS string when it needs functions); null if QuickChart fails. */
export async function render(chart, width, height) {
  try {
    const res = await fetch(`${QUICKCHART}/chart/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chart, width, height, backgroundColor: '#0d0b0b', format: 'png', version: '4' }),
      signal: AbortSignal.timeout(20_000),
    })
    const j = await res.json()
    return j.success ? j.url : null
  } catch {
    return null
  }
}

/** Everything the portfolio screen needs: summary + chart URL (null if there's nothing to draw). */
export async function report(now = Date.now()) {
  const s = await summary()
  if (!s.events.length) return { ...s, chart: null }
  const [interval] = intervalFor(now - s.events[0].at)
  const tokens = [...new Set(s.events.map((e) => e.token))]
  const prices = Object.fromEntries(await Promise.all(tokens.map(async (t) => [t, await klines(t, interval).catch(() => [])])))
  return { ...s, chart: await chartUrl(pnlSeries(s.events, prices, now)) }
}
