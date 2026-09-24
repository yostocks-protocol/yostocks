# yostocks

Buy tokenized US stocks on BNB Smart Chain without getting trapped by a bad quote.

The same stock exists as three tokens on BSC: Ondo (`NVDAon`), xStocks (`NVDAx`) and bStocks (`NVDAB`).
Their quotes aren't equally safe: in our testing some xStocks quotes came back `success: true` while paying
out ~0 tokens (MSTRx: an effective **$4.16B per share**). yostocks quotes every provider, converts each
quote to a per-share price (dividend/split `multiplier` included), rejects anything that disagrees with the
reference price, is paused (earnings, split, dividend) or has no liquidity, then buys from the best one via
Binance Agentic Wallet.

```
$ yo quote MSTR 100

MSTR · 100 USDT · reference $158.82/share

✓ Ondo     MSTRon    $159.22/share (+0.25%)
✗ xStocks  MSTRx     2620826935.93% off reference
★ bStocks  MSTRB     $159.16/share (+0.21%)

best: MSTRB → 0.628311 tokens
```

## Mainnet proof

First live buy through the Telegram bot on BSC mainnet (2026-09-24 19:48 WIB): `/buy NVDA 5` → guard picked
bStocks (NVDAB −0.12% vs Ondo +0.32%, xStocks no liquidity) → 5 USDT → 0.022409841731513969 NVDAB,
tx [`0xfe3a3f…04b9`](https://bscscan.com/tx/0xfe3a3f460a2f278ec91f8dfc550043bf5ed8d9726952bcceb572ace52ef404b9).

## Run

Requires Node ≥ 22 and the Binance Agentic Wallet CLI.

```sh
npm i -g @binance/agentic-wallet
baw auth signin          # confirm in the Binance App
cd apps/agent
node yo.mjs quote NVDA 100
node yo.mjs buy NVDA 100     # asks before swapping; --yes to skip
```

| env | default | meaning |
|---|---|---|
| `YO_MAX_DEV` | `1` | max % a quote may differ from the reference price |
| `YO_SLIPPAGE` | `1` | swap slippage % |
| `BAW` | `baw` | path to the `baw` binary |

## Telegram bot

```sh
cp .env.example .env     # TELEGRAM_BOT_TOKEN from @BotFather
npm start -w apps/bot    # message the bot once, it replies with your chat id
                         # put it in YO_OWNER_CHAT_ID and restart
```

`/quote NVDA 10` shows the guarded comparison. `/buy NVDA 10` shows it with Confirm/Cancel buttons;
Confirm re-runs the guard (quotes older than 60s are refused) before swapping. Only the owner chat can use the wallet.

`/strategy buy $10 of NVDA every Monday 9pm, skip earnings, max 0.5% premium` → an OpenAI model (`gpt-4o-mini` by default,
`YO_LLM_MODEL` to change; strict JSON-schema output) turns it into a fixed rule, shown back in plain words with a Save button. Fixed code enforces the bounds
(1–1000 USDT, premium cap ≤ 1%), and anything the rule can't express (selling, stop-losses, several stocks) is
refused, not approximated. Needs `OPENAI_API_KEY` in `.env`. `/strategies` lists, `/stop <id>` removes.

Saved strategies run on their own. Every minute the bot checks which rules are due; each run goes
through the same guard as `/buy`, then the rule's conditions (earnings limits, premium cap), then a
**daily spend cap across all strategies** (`YO_DAILY_CAP`, default 50 USDT, pending orders count).
Every run is reported in Telegram: filled with the BscScan link, skipped with the reason, or an error
such as an expired wallet session. A slot missed by more than 2h (bot was down) is skipped, not
run late, and a slot is never run twice.

## Testing

```sh
npm test            # offline: unit + regression + mocked integration (agent, bot, yoguard)
npm run test:live   # real Binance RWA API + yoguard over A2A (needs WARP in ID, `bag dev` running)
YO_LIVE_BAW=1 npm run test:live -w apps/agent   # also a real read-only quote through Agentic Wallet
npm run record -w apps/agent                     # refresh fixtures from the live API
```

- **Unit**: guard rules (deviation boundaries, multiplier, paused assets, ~0 output), table format, bot command parsing, yoguard request parsing.
- **Regression**: recorded RWA responses + a fake `baw` replay every failure we hit on mainnet: MSTRx `success:true` with ~0 tokens, xStocks "No liquidity", METAx at a stale −21% price, `SESSION_EXPIRED`, off-hours reference fallback, undocumented provider types.
- **Integration**: Telegram flows end to end against a fake Bot API (owner-only, Confirm re-checks, double tap, expired button, FAILED order); yoguard `negotiate` over A2A.
- **Parity**: yoguard's copy of the guard must agree with the CLI's on the same inputs.

## Layout

- `apps/agent`: the CLI agent (`yo`), zero dependencies. `npm test` runs its guard tests.
- `apps/bot`: Telegram bot on top of the agent, zero dependencies.
- `probe/`: throwaway research scripts.
- `DX_LOG.md`: developer-experience friction log for the hackathon DX report.

Built for BNB Hack: Tokenized Stocks Edition.
