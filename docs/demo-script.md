# Demo video script (≤ 4:00)

Record on a phone (Telegram) plus a laptop (website, BscScan). Keep the wallet funded with about 40 USDT on BSC.
Say the lines in your own words. The times are targets; button labels are exactly what the bot shows.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:15 | yostocks.xyz: globe hero, then scroll to the rotating stock cards and the chat mock | "Buy US stocks right in Telegram, any day, any hour. NVIDIA, Tesla, Apple, as tokens on BNB Chain." |
| 0:15–0:30 | @yostocksbot → Start: the price board picture | "Every stock with its price and 24-hour move, in one picture." |
| 0:30–0:55 | Tap **NVIDIA** → card (facts table, **✅ Fair price**) → **🔗 Connect Binance to buy** → Binance app, check the code, approve → back on NVIDIA with Buy buttons | "The same stock trades three times on BNB Chain: Ondo, xStocks and bStocks. yostocks checks every one against the real NVIDIA price. To buy, I connect my own Binance Agentic Wallet: no seed phrase, no deposit to us, and the spending limit is mine." |
| 0:55–1:25 | **Buy $10** → ⏳ → **✅ Done! You bought NVIDIA** → tap *See the transaction ↗* (BscScan) | "One tap. It checks the price again right before the swap, buys on BSC mainnet, and only says done once it's filled." |
| 1:25–1:45 | **ℹ️ Details** (provider comparison) | "Why bStocks? It's the cheapest safe route. A quote that's off the real price, or pays almost nothing, is refused." |
| 1:45–2:05 | **💼 My stocks**: PnL chart + profit line | "What I own, what it's worth, and my profit or loss, from my own order history." |
| 2:05–2:40 | NVIDIA → **🎯 Buy if it drops** → −5% → $10 → **✅ Place order** → "Nothing is bought yet" → My stocks → **📋 Orders** | "Now the agent works while I sleep. A limit order waits inside my Binance wallet and buys by itself if NVIDIA drops 5%. The bot watches it and tells me when it fills." |
| 2:40–2:55 | NVIDIA → **🔁 Auto-invest** → $10 → Every Monday → **✅ Start** | "Or invest the same amount every week. Every buy still passes the price check, with a daily cap." |
| 2:55–3:10 | My stocks → **🛡 Safety** | "And I can see the brakes: my daily limit and what's left, risky trades blocked, token approvals I can clean up." |
| 3:10–3:25 | **🔔 Alert me** on Tesla → ±5% | "No wallet? Anyone can set a price alert and get one message when it moves." |
| 3:25–3:40 | `/macro` → Pay → calendar | "The agent also pays for its own data: this week's CPI and Fed calendar, bought agent-to-agent over x402." |
| 3:40–3:50 | yoguard in BNB Agent Studio (job + ERC-8004 registration) | "The price guard is sold to other agents too, as a BNB Agent Studio seller." |
| 3:50–4:00 | README mainnet proof table / DX_LOG | "All on BSC mainnet, open source, with 35+ developer-experience findings logged along the way." |

## Before recording
- Owner wallet CONNECTED (Telegram: 🔗 Connect Binance to buy, or `docker exec <bot container> baw wallet status --json`). Needed for `/macro` and for everyone's price verdicts.
- The Connect scene: record it with the owner's own wallet after tapping **🔌 Disconnect**, or with a second Binance account. Never connect the owner wallet from a second chat: one session per wallet.
- Cancel the demo limit order afterwards (📋 Orders → ✖ Cancel 1) and stop the auto-invest (🔁 Auto-invest → ⏹ Stop 1) unless you want them to run.
- US market hours help: Ondo sells are refused outside them. bStocks trade 24/7.
- yoguard: deploy on the 48h trial right before this recording (issue #10).
