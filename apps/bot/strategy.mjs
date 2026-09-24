// Plain-English strategy → a small, fixed rule the runner can execute.
// The LLM only translates; bounds and the final yes/no are fixed code + the user's Confirm.
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'

const MODEL = process.env.YO_LLM_MODEL ?? 'gpt-4o-mini'

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const MAX_USDT = 1000

export const Rule = z.object({
  ticker: z.string().describe('US ticker of the underlying stock, e.g. NVDA'),
  usdt: z.number().describe('USDT to spend per run'),
  every: z.enum(['day', 'week']),
  weekday: z.enum(DAYS).nullable().describe('required when every = week, else null'),
  hourUtc: z.number().int().describe('hour of day in UTC, 0-23'),
  skipEarnings: z.boolean().describe('skip runs while the stock has earnings trading limits'),
  maxPremiumPct: z.number().nullable().describe('only buy if the best quote is at most this % above the real stock price; null = guard default'),
  unsupported: z.array(z.string()).describe('parts of the request that none of these fields can express'),
})

const SYSTEM = `You turn a user's plain-English plan for buying tokenized US stocks on BNB Chain into one rule.
The user is in Indonesia (WIB = UTC+7): convert any local time to UTC. If no time is given use hourUtc 14 (after the US open).
Only these actions exist: buy a fixed USDT amount of one stock daily or weekly, optionally skipping earnings periods and capping the premium over the real stock price.
Anything else (selling, stop-losses, several stocks, percentages of a portfolio, conditions on other assets, leverage) goes verbatim into "unsupported"; do not approximate it.`

export const deps = { client: null } // tests inject a fake client here

export async function parseStrategy(text) {
  deps.client ??= new OpenAI() // OPENAI_API_KEY from the environment
  const res = await deps.client.responses.parse({
    model: MODEL,
    instructions: SYSTEM,
    input: text,
    text: { format: zodTextFormat(Rule, 'strategy_rule') },
  })
  const refusal = res.output?.flatMap((o) => o.content ?? []).find((c) => c.type === 'refusal')
  if (refusal) throw new Error(`the model declined to parse this strategy: ${refusal.refusal}`)
  if (res.status === 'incomplete' || !res.output_parsed) throw new Error('could not parse the strategy, try rephrasing')
  return res.output_parsed
}

/** Hard bounds, independent of what the model returned. */
export function validate(r) {
  const errors = []
  if (!/^[A-Z.]{1,10}$/.test(r.ticker ?? '')) errors.push(`bad ticker "${r.ticker}"`)
  if (!(r.usdt > 0 && r.usdt <= MAX_USDT)) errors.push(`amount must be 1–${MAX_USDT} USDT`)
  if (r.every === 'week' && !DAYS.includes(r.weekday)) errors.push('weekly rule needs a weekday')
  if (!Number.isInteger(r.hourUtc) || r.hourUtc < 0 || r.hourUtc > 23) errors.push('hour must be 0–23 UTC')
  if (r.maxPremiumPct != null && !(r.maxPremiumPct >= 0 && r.maxPremiumPct <= 1)) errors.push('premium cap must be 0–1% (the guard never allows more than 1%)')
  if (r.unsupported?.length) errors.push(`not supported: ${r.unsupported.join('; ')}`)
  return errors
}

const DAY_NAME = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
const hh = (h) => String(h).padStart(2, '0') + ':00'

export function describe(r) {
  const when = r.every === 'day' ? 'every day' : `every ${DAY_NAME[r.weekday]}`
  const parts = [`Buy ${r.usdt} USDT of ${r.ticker} ${when} at ${hh(r.hourUtc)} UTC (${hh((r.hourUtc + 7) % 24)} WIB)`]
  if (r.skipEarnings) parts.push('skip while earnings limits are active')
  parts.push(r.maxPremiumPct != null ? `only if ≤ ${r.maxPremiumPct}% above the real price` : 'only if within the guard limit (1%)')
  return parts.join('\n· ')
}
