// Everything the page says, in one typed place. Numbers and tx hashes are from the repo's
// README / DX_LOG (verified on BSC mainnet); change them there first.

export const links = {
  bot: 'https://t.me/yostocksbot',
  repo: 'https://github.com/yostocks-protocol/yostocks',
  dxLog: 'https://github.com/yostocks-protocol/yostocks/blob/main/DX_LOG.md',
} as const

/** The three reasons, as glow cards. `glow` is the card's border + halo gradient. */
export interface Pillar { icon: 'tap' | 'clock' | 'shield'; title: string; body: string; glow: string }
export const pillars: Pillar[] = [
  { icon: 'tap', title: 'Tap. Bought.', body: 'Pick a stock, tap $10, done. No broker account and no forms: just Telegram and your Binance wallet.', glow: 'linear-gradient(137deg, #f4ecd6 0%, #f3a38f 45%, #e2574c 100%)' },
  { icon: 'clock', title: 'Open 24/7', body: 'Tokenized stocks trade around the clock, weekends too. Buy when it suits you, not when Wall Street opens.', glow: 'linear-gradient(137deg, #fff3c4 0%, #f0b90b 45%, #ff8a3c 100%)' },
  { icon: 'shield', title: 'Real price, or no trade', body: 'Every order is checked against the real US stock price. A quote that is off never goes through.', glow: 'linear-gradient(137deg, #e8fff0 0%, #7ddc9a 45%, #1fb5a4 100%)' },
]

export interface Step { num: string; title: string; body: string }
export const steps: Step[] = [
  { num: '01', title: 'Open the bot', body: 'Start @yostocksbot. Live prices for NVIDIA, Tesla, Apple and more are right there.' },
  { num: '02', title: 'Connect Binance', body: 'Tap Connect and approve in the Binance app. Your money stays in your own wallet, within the limit you set.' },
  { num: '03', title: 'Tap Buy', body: 'Pick $5, $10, $25 or type any amount. A receipt with the on-chain proof arrives in seconds.' },
]

/** `body` may contain inline <code>/<b>; it is authored here, never user input. */
export interface Feature { icon: string; title: string; body: string }
export const features: Feature[] = [
  { icon: '🛡', title: 'Quote guard', body: 'Cheapest safe provider or no trade at all. Tap <b>Buy $10</b> or <b>Sell</b>: the guard runs again right before the trade, and buttons expire after 60 seconds.' },
  { icon: '🔗', title: 'Your wallet, your limits', body: 'Tap <b>Connect Binance to buy</b> and approve in the Binance app. Every trade runs on your own Agentic Wallet, inside the spending limit you set there.' },
  { icon: '📈', title: 'Profit at a glance', body: '<b>My stocks</b> shows what you own, your profit or loss since you bought, and a chart of it over time, built from your own order history.' },
  { icon: '🗣', title: 'Plain-English autopilot', body: "<code>/strategy buy $10 of NVDA every Monday, skip earnings</code>. The AI translates; fixed code enforces the rule, the guard and a daily spend cap." },
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

export interface Faq { q: string; a: string }
export const faqs: Faq[] = [
  { q: 'Do I need a broker account?', a: 'No. You need Telegram and a Binance account with the Agentic Wallet. yostocks connects to it in two taps.' },
  { q: 'Can I really buy on weekends?', a: 'Yes. The tokens trade on BNB Chain 24/7. Each stock card also shows whether the US market itself is open.' },
  { q: 'Who holds my money?', a: 'You do. Everything stays in your own Binance Agentic Wallet. yostocks can only spend within the limit you set in the Binance app, and you can disconnect at any time.' },
  { q: 'What do I actually own?', a: 'A tokenized share on BNB Chain (bStocks, Ondo or xStocks) that tracks the real stock price. Sell it back to USDT in the bot whenever you like.' },
  { q: 'Is there a fee?', a: 'yostocks adds no fee of its own. You pay the on-chain swap price, which the bot shows and checks before every buy.' },
]

export const brands = ['BNB Chain', 'Agentic Wallet', 'bStocks', 'Ondo', 'xStocks', 'Agent Studio'] as const
