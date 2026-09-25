# Demo video script (≤ 4:00)

Record on a phone (Telegram) plus a laptop (website, BscScan, terminal). Keep the wallet funded with about 30 USDT on BSC.
Say the lines in your own words. The times are targets.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:20 | yostocks.xyz hero | "The same stock, like NVIDIA, is on BNB Chain three times: Ondo, xStocks and bStocks. They trade at different prices, and some quotes are simply wrong. yostocks buys from the cheapest one that matches the real stock price, or it doesn't buy at all." |
| 0:20–0:45 | Telegram: @yostocksbot → Start → NVIDIA → **🔗 Connect Binance to buy** → Binance app approve → back on NVIDIA | "No seed phrase and no deposit to us. I connect my own Binance Agentic Wallet and set how much the agent may spend." Show the pairing code matching, then ✅ Wallet connected. |
| 0:45–1:25 | Tap **NVIDIA** → card → **ℹ️ Why?** | "It checked every provider against the live NVIDIA price, per share, including the token's share multiplier. bStocks is 0.1% under, Ondo is 0.3% over, xStocks has no liquidity, so it's skipped." |
| 1:25–2:00 | **Buy $10** → ⏳ → ✅ receipt → tap BscScan link | "Before the swap it runs the guard again, because prices move. The swap is on BSC mainnet, and the receipt only comes after the order is actually filled." |
| 2:00–2:30 | **💼 My stocks**: PnL chart + lines | "What I own, what it's worth, and profit or loss since I bought, from my own order history. The chart is profit over time from hourly prices." |
| 2:30–2:50 | Sell NVIDIA → Sell card → confirm | "Selling goes through the same guard, so I never dump below the real price." |
| 2:50–3:15 | `/strategy buy $10 of NVDA every Monday, skip earnings` → Save | "Plain-English autopilot. The AI only translates. Fixed code enforces the rule, the guard and a daily spend cap." |
| 3:15–3:35 | `/macro` → Pay → calendar | "The agent pays for its own data: this week's CPI and Fed calendar, bought agent-to-agent over x402 from the same wallet." |
| 3:35–3:50 | yoguard in BNB Agent Studio (job + ERC-8004 registration) | "The guard is also sold to other agents as a BNB Agent Studio seller over ERC-8183." |
| 3:50–4:00 | README mainnet proof table / DX_LOG | "Everything is on mainnet, open source, and we logged 30+ developer-experience findings along the way." |

## Before recording
- `docker exec <bot container> baw wallet status --json` shows CONNECTED (owner session, for `/macro`).
- Use a **second** Binance account for the Connect scene. Connecting the owner wallet from another chat signs the bot's owner session out.
- US market hours help: Ondo sells are refused outside them.
- yoguard: deploy on the 48h trial right before this recording (issue #10).
