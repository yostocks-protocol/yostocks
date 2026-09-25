// Everything the page says, in one typed place. Numbers and tx hashes are from the repo's
// README / DX_LOG (verified on BSC mainnet); change them there first.

export const links = {
  bot: 'https://t.me/yostocksbot',
  repo: 'https://github.com/yostocks-protocol/yostocks',
  dxLog: 'https://github.com/yostocks-protocol/yostocks/blob/main/DX_LOG.md',
} as const

export interface Step { num: string; title: string; body: string }
export const steps: Step[] = [
  { num: '01 · SCAN', title: 'Every provider, every time', body: 'Ondo, xStocks and bStocks tokens for the ticker come from the Binance RWA Data API. Each gets a live swap quote from your Agentic Wallet.' },
  { num: '02 · GUARD', title: 'Priced per share, checked against reality', body: 'Each quote becomes a price per share (dividend and split multiplier included) and must sit within 1% of the real US price. ~0 output, paused assets and empty pools are rejected.' },
  { num: '03 · FILL', title: 'Best route, confirmed', body: 'You tap Confirm, the guard runs again, the swap executes on BSC mainnet, and the bot waits for a real fill before sending a receipt with the BscScan link.' },
]

/** `body` may contain inline <code>/<b>; it is authored here, never user input. */
export interface Feature { icon: string; title: string; body: string }
export const features: Feature[] = [
  { icon: '🛡', title: 'Quote guard', body: 'Cheapest safe provider or no trade at all. Buttons expire after 60 seconds and work once.' },
  { icon: '💱', title: 'Tap to buy, tap to sell', body: 'Pick a stock, tap <b>Buy $10</b>. Open <b>My stocks</b>, tap <b>Sell</b>. Every tap runs the guard again, so you never buy above or dump below the real price.' },
  { icon: '🗣', title: 'Plain-English strategies', body: "<code>/strategy buy $10 of NVDA every Monday, skip earnings</code>. The AI translates, fixed code enforces the limits, anything it can't express is refused." },
  { icon: '🤖', title: 'Autopilot with brakes', body: "Saved rules run on schedule through the guard, the rule's conditions and a daily spend cap. Every run is reported." },
  { icon: '💳', title: 'Pays for its own data', body: "<code>/macro</code> buys this week's CPI, jobs and Fed calendar agent-to-agent over <b>x402</b>, straight from the Agentic Wallet." },
  { icon: '🏪', title: 'Guard as a service', body: '<b>yoguard</b> is a BNB Agent Studio seller agent: other agents can buy a quote verdict over ERC-8183.' },
]

export interface Proof { title: string; detail: string; tx: `0x${string}` }
export const proofs: Proof[] = [
  { title: 'First buy through the bot: 5 USDT → 0.0224 NVDAB', detail: 'Guard picked bStocks (−0.12%) over Ondo (+0.32%); xStocks had no liquidity. Slippage 0.01%.', tx: '0xfe3a3f460a2f278ec91f8dfc550043bf5ed8d9726952bcceb572ace52ef404b9' },
  { title: 'x402 payment for the macro calendar', detail: '0.1 USD1, EIP-3009, from the Agentic Wallet to a Binance Bazaar merchant.', tx: '0xe21fbbfe6d033971d8f12542e858f39a1969586b9161c3a8397dffeb4f76387a' },
  { title: 'x402 payment to CoinMarketCap MCP', detail: '0.01 U for a market snapshot, settled on-chain.', tx: '0xff8868500d6dcd78e8b1c3be02702d9f475f5006197212355a8b4e6b54cd3123' },
]
export const shortTx = (tx: string) => `${tx.slice(0, 8)}…${tx.slice(-4)}`

export type Tone = 'good' | 'warn' | 'info'
export interface Finding { tag: string; tone: Tone; title: string; body: string }
export const findings: Finding[] = [
  { tag: 'bStocks', tone: 'good', title: 'The deepest liquidity, 24/7', body: 'NVDAB had ~$3.5M in its PancakeSwap pool and quoted buys and sells around the clock.' },
  { tag: 'Ondo', tone: 'warn', title: 'Buy anytime, sell only in market hours', body: 'Ondo tokens filled at the reference price, but sells were refused outside US hours while the asset still showed as trading.' },
  { tag: 'xStocks', tone: 'warn', title: 'Thin on BSC', body: 'Most xStocks pools were empty; a displayed price was 21% stale and one quote paid ~0 tokens.' },
  { tag: 'Developer experience', tone: 'info', title: '30+ issues logged, with evidence', body: 'From session expiry in containers to unlistable order ids and opaque x402 rejections, every one with a timestamp.' },
]

export const brands = ['BNB Chain', 'Agentic Wallet', 'bStocks', 'Ondo', 'xStocks', 'Agent Studio'] as const
