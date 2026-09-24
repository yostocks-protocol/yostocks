/**
 * yostocks guard: checks a tokenized-stock swap quote on BSC against the real
 * stock price before a buyer agent trades it. Public Binance RWA data only, no
 * wallet session, so it runs inside the seller runtime.
 *
 * ponytail: same rules as apps/agent/yo.mjs `judge()`, copied because only
 * app/agent/ is packaged on deploy. Change both together.
 */

const API = "https://www.binance.com/bapi/defi";
const HEADERS = { "Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)" };
const PROVIDER: Record<number, string> = { 1: "Ondo", 2: "xStocks", 3: "bStocks" };
const BLOCKED = ["ASSET_PAUSED", "UNSUPPORTED", "MARKET_MAINTENANCE", "MARKET_PAUSED"];
const MAX_DEV = 1; // % a quote may differ from the reference price

export interface GuardRequest {
  ticker: string;
  usdt: number;
  /** Quotes the buyer got from its own router: token address + tokens out for `usdt` in. */
  quotes?: { token: string; toCoinAmount: string | number }[];
}

type Json = Record<string, any>;

async function api(path: string): Promise<any> {
  const res = await fetch(API + path, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  const j = (await res.json()) as Json;
  if (!j.success) throw new Error(`${path}: ${j.code} ${j.message}`);
  return j.data;
}

const rwa = (kind: "dynamic" | "status", token: string) =>
  api(
    kind === "dynamic"
      ? `/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai?chainId=56&contractAddress=${token}`
      : `/v1/public/wallet-direct/buw/wallet/market/token/rwa/asset/market/status/ai?chainId=56&contractAddress=${token}`,
  );

/** Per-share price a quote implies, checked against the reference. Pure. */
export function judge(usdt: number, got: number, multiplier: number, ref: number, status?: Json) {
  if (BLOCKED.includes(status?.reasonCode)) return { ok: false, why: `${status!.reasonCode} ${status!.reasonMsg ?? ""}`.trim() };
  const perShare = usdt / got / multiplier;
  const dev = (perShare / ref - 1) * 100;
  if (!(got > 0) || !Number.isFinite(dev)) return { ok: false, why: "quote returns ~0 tokens" };
  if (Math.abs(dev) > MAX_DEV) return { ok: false, perShare, dev, why: `${dev.toFixed(2)}% off reference` };
  return { ok: true, perShare, dev };
}

/** Accepts the JSON request shape, or null if `text` isn't one. */
export function parseRequest(text: string): GuardRequest | null {
  try {
    const r = JSON.parse(text.trim()) as Json;
    const ticker = String(r.ticker ?? "").toUpperCase();
    const usdt = Number(r.usdt);
    if (!/^[A-Z.]{1,10}$/.test(ticker) || !(usdt > 0)) return null;
    const quotes = Array.isArray(r.quotes)
      ? r.quotes.filter((q: Json) => /^0x[0-9a-fA-F]{40}$/.test(q?.token)).slice(0, 5)
      : undefined;
    return { ticker, usdt, quotes };
  } catch {
    return null;
  }
}

export async function check({ ticker, usdt, quotes }: GuardRequest) {
  const list = (await api("/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai")) as Json[];
  const tokens = list.filter((t) => t.chainId === "56" && PROVIDER[t.type] && t.ticker === ticker);
  if (!tokens.length) return { ticker, error: `${ticker} is not tokenized on BSC` };

  const rows = await Promise.all(
    tokens.map(async (t) => {
      const [dyn, status] = await Promise.all([rwa("dynamic", t.contractAddress), rwa("status", t.contractAddress)]);
      return { t, dyn, status, multiplier: Number(dyn.tokenInfo.sharesMultiplier || t.multiplier || 1) };
    }),
  );
  const withStock = rows.find((r) => r.dyn.stockInfo?.price);
  const ondo = rows.find((r) => r.t.type === 1);
  const ref = withStock ? Number(withStock.dyn.stockInfo.price) : ondo ? Number(ondo.dyn.tokenInfo.price) / ondo.multiplier : NaN;
  if (!(ref > 0)) return { ticker, error: `no reference price for ${ticker}` };

  const providers = rows.map((r) => {
    const q = quotes?.find((x) => x.token.toLowerCase() === r.t.contractAddress.toLowerCase());
    return {
      provider: PROVIDER[r.t.type],
      symbol: r.t.symbol,
      token: r.t.contractAddress,
      multiplier: r.multiplier,
      status: r.status?.reasonCode ?? null,
      quote: q ? judge(usdt, Number(q.toCoinAmount), r.multiplier, ref, r.status) : null,
    };
  });
  const best = providers
    .filter((p) => p.quote?.ok)
    .sort((a, b) => a.quote!.perShare! - b.quote!.perShare!)[0];
  return {
    ticker,
    usdt,
    reference: ref,
    referenceSource: withStock ? "US stock price" : "Ondo oracle / multiplier",
    maxDeviationPct: MAX_DEV,
    providers,
    best: best ? best.symbol : null,
    verdict: quotes?.length ? (best ? `trade ${best.symbol}` : "no safe quote, do not trade") : "no quotes given, reference only",
  };
}
