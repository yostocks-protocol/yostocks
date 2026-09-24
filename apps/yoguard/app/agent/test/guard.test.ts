// yoguard unit + regression: request parsing, parity with the CLI guard, check() on recorded data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: shared plain-JS test helpers from the CLI agent
import { FIXTURE, addr, clone, mockFetch } from "../../../../agent/test/helpers.mjs";
// @ts-ignore
import { judge as cliJudge } from "../../../../agent/yo.mjs";
import { check, judge, parseRequest } from "../src/guard.js";

let restore: () => void;
before(() => { restore = mockFetch(); });
after(() => restore());

const price = (sym: string) => Number(FIXTURE.dynamic[addr(sym)].data.stockInfo.price ?? FIXTURE.dynamic[addr(sym)].data.tokenInfo.price);
const mult = (sym: string) => Number(FIXTURE.dynamic[addr(sym)].data.tokenInfo.sharesMultiplier);
const ref = (t: string) => price(`${t}on`);
const fair = (sym: string, t: string, pct = 0) => String(100 / (ref(t) * (1 + pct / 100) * mult(sym)));

test("parseRequest accepts the documented JSON shape and normalizes the ticker", () => {
  const r = parseRequest(JSON.stringify({ ticker: "nvda", usdt: 100, quotes: [{ token: "0x" + "a".repeat(40), toCoinAmount: "0.44" }] }));
  assert.deepEqual(r, { ticker: "NVDA", usdt: 100, quotes: [{ token: "0x" + "a".repeat(40), toCoinAmount: "0.44" }] });
});

test("parseRequest rejects prose, injection-ish tickers, bad amounts; drops bad addresses; caps at 5 quotes", () => {
  for (const bad of ["is MSTRx safe?", '{"ticker":"$(rm)","usdt":5}', '{"ticker":"NVDA","usdt":0}', '{"ticker":"NVDA","usdt":-1}', '{"ticker":"NVDA"}', "[]", ""])
    assert.equal(parseRequest(bad), null, bad);
  const many = Array.from({ length: 8 }, (_, i) => ({ token: "0x" + String(i).repeat(40), toCoinAmount: "1" }));
  const r = parseRequest(JSON.stringify({ ticker: "NVDA", usdt: 1, quotes: [{ token: "0xnope", toCoinAmount: "1" }, ...many] }))!;
  assert.equal(r.quotes!.length, 5);
  assert.ok(r.quotes!.every((q) => /^0x[0-9]{40}$/.test(q.token)));
});

test("parity: yoguard judge() agrees with the CLI judge() (logic is duplicated for deploy packaging)", () => {
  const status = { reasonCode: "TRADING" };
  const cases: [number, number, number, number, Record<string, string>][] = [
    [100, 0.449, 1.0017, 222.4, status],
    [100, 0.000000024, 1, 157, status],
    [100, 0.1747, 1, 723.6, status],
    [100, 0.04, 10, 250, status],
    [100, 0, 1, 1, status],
    [100, 0.449, 1, 222.7, { reasonCode: "ASSET_PAUSED", reasonMsg: "stock_split" }],
    [100, 0.449, 1, 222.7, { reasonCode: "ASSET_LIMITED", reasonMsg: "earnings" }],
    [5, 100 / 99.01 / 20, 1, 5, status],
  ];
  for (const [usdt, got, m, r, st] of cases) {
    const a = judge(usdt, got, m, r, st);
    const b = cliJudge({ usdt, quote: { success: true, data: { toCoinAmount: String(got) } }, multiplier: m, status: st }, r, 1);
    assert.equal(a.ok, b.ok, `ok mismatch for ${JSON.stringify([usdt, got, m, r, st])}`);
    if ("dev" in a && a.dev !== undefined) assert.ok(Math.abs(a.dev - b.dev) < 1e-9);
  }
});

test("check(): MSTRx ~0-output quote rejected, cheapest safe token wins (regression 2026-09-24)", async () => {
  const v: any = await check({ ticker: "MSTR", usdt: 100, quotes: [
    { token: addr("MSTRon"), toCoinAmount: fair("MSTRon", "MSTR", 0.3) },
    { token: addr("MSTRx"), toCoinAmount: "0.000000024" },
    { token: addr("MSTRB"), toCoinAmount: fair("MSTRB", "MSTR", 0.2) },
  ] });
  assert.equal(v.best, "MSTRB");
  assert.equal(v.verdict, "trade MSTRB");
  assert.equal(v.providers.find((p: any) => p.symbol === "MSTRx").quote.ok, false);
  assert.equal(v.referenceSource, "US stock price");
});

test("check(): no quotes → reference data only, never a trade verdict", async () => {
  const v: any = await check({ ticker: "NVDA", usdt: 100 });
  assert.equal(v.best, null);
  assert.equal(v.verdict, "no quotes given, reference only");
  assert.deepEqual(v.providers.map((p: any) => p.provider).sort(), ["Ondo", "bStocks", "xStocks"]);
  assert.ok(v.providers.every((p: any) => p.quote === null));
});

test("check(): all quotes unsafe → do not trade", async () => {
  const v: any = await check({ ticker: "META", usdt: 100, quotes: [{ token: addr("METAx"), toCoinAmount: String(100 / 573.75) }] });
  assert.equal(v.verdict, "no safe quote, do not trade");
});

test("check(): unknown ticker and missing reference are errors, not guesses", async () => {
  assert.match(((await check({ ticker: "ZZZZ", usdt: 1 })) as any).error, /not tokenized on BSC/);
  const fx = clone(FIXTURE);
  fx.list.data = fx.list.data.filter((t: any) => !(t.ticker === "NVDA" && t.type === 1));
  for (const d of Object.values<any>(fx.dynamic)) d.data.stockInfo.price = null;
  restore(); restore = mockFetch(fx);
  try {
    assert.match(((await check({ ticker: "NVDA", usdt: 1 })) as any).error, /no reference price/);
  } finally { restore(); restore = mockFetch(); }
});

test("check(): quote for a token of a different ticker is ignored", async () => {
  const v: any = await check({ ticker: "NVDA", usdt: 100, quotes: [{ token: addr("MSTRB"), toCoinAmount: "0.6" }] });
  assert.ok(v.providers.every((p: any) => p.quote === null));
  assert.equal(v.best, null);
});
