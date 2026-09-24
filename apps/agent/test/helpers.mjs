// Test helpers: recorded RWA fixtures behind a fetch mock, and fake-baw scenarios.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/rwa.json', import.meta.url), 'utf8'))
export const FAKE_BAW = new URL('./fake-baw.mjs', import.meta.url).pathname
export const clone = (x) => structuredClone(x)

/** BSC token address for `symbol` (e.g. "MSTRx") from the fixture list. */
export const addr = (symbol, fx = FIXTURE) => fx.list.data.find((t) => t.chainId === '56' && t.symbol === symbol).contractAddress.toLowerCase()

/** Quote response the way baw returns it. */
export const quote = (toCoinAmount) => ({ success: true, data: { toCoinAmount: String(toCoinAmount), slippage: 0.01 } })

/** Serve Binance RWA calls from `fx`; route tg.test to `tg(method, body)`; block everything else. */
export function mockFetch(fx = FIXTURE, { tg } = {}) {
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const u = new URL(url)
    if (u.hostname === 'www.binance.com') {
      const a = u.searchParams.get('contractAddress')?.toLowerCase()
      const meta = { success: true, data: { icon: `/logos/${a}.png`, companyInfo: { companyName: 'Nvidia Corp' } } }
      const body = u.pathname.includes('/detail/list/') ? fx.list : u.pathname.includes('/dynamic/') ? fx.dynamic[a] : u.pathname.includes('/status/') ? fx.status[a] : u.pathname.includes('/rwa/meta/') ? (fx.meta?.[a] ?? meta) : null
      if (!body) throw new Error(`unmocked ${url}`)
      return Response.json(body)
    }
    if (tg && u.hostname === 'tg.test') return Response.json({ ok: true, result: await tg(u.pathname.split('/').pop(), JSON.parse(init.body)) })
    throw new Error(`network blocked in tests: ${url}`)
  }
  return () => { globalThis.fetch = real }
}

/** Write a fake-baw scenario; returns { file, calls() } where calls() = parsed argv of every baw call. */
export function scenario(s) {
  const dir = mkdtempSync(join(tmpdir(), 'yo-'))
  const file = join(dir, 'baw.json')
  const log = join(dir, 'calls.log')
  writeFileSync(log, '')
  const set = (next) => writeFileSync(file, JSON.stringify({ ...next, log }))
  set(s)
  return { file, set, calls: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) }
}
