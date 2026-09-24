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

## Layout

- `apps/agent`: the CLI agent (`yo`), zero dependencies. `npm test` runs its guard tests.
- `probe/`: throwaway research scripts.
- `DX_LOG.md`: developer-experience friction log for the hackathon DX report.

Built for BNB Hack: Tokenized Stocks Edition.
