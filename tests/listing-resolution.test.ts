import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveReference,
  secListing,
  aliasKey,
} from "../src/server/youtube-intelligence/listings/resolve.ts";
import { US_ALIASES, CURATED } from "../src/server/youtube-intelligence/listings/curated.ts";

test("every curated US ticker exists in the SEC snapshot", () => {
  for (const ticker of Object.keys(US_ALIASES))
    assert.ok(secListing(ticker), `${ticker} is not in the SEC snapshot`);
});

test("no alias names two instruments", () => {
  const owner = new Map<string, string>();
  const claim = (alias: string, who: string) => {
    const k = aliasKey(alias);
    const prior = owner.get(k);
    assert.ok(!prior || prior === who, `"${alias}" names both ${prior} and ${who}`);
    owner.set(k, who);
  };
  for (const [ticker, aliases] of Object.entries(US_ALIASES)) for (const a of aliases) claim(a, ticker);
  for (const c of CURATED) for (const a of [...c.aliases, ...(c.symbol ? [c.symbol] : [])]) claim(a, c.symbol ?? c.name);
});

test("a spoken ticker resolves when it is a real listing", () => {
  assert.deepEqual(
    pick(resolveReference("AMD", null)),
    { symbol: "AMD", market: "us-stock", method: "spoken_ticker", source: "sec" },
  );
  assert.equal(resolveReference("ELF", null)?.symbol, "ELF");
  assert.equal(resolveReference("ZEC", null)?.market, "crypto");
  assert.equal(resolveReference("GGD", null)?.exchange, "TSX");
  assert.equal(resolveReference("XYZQW", null), null);
  assert.equal(resolveReference("长债ETF TLT", "TLT")?.method, "spoken_ticker");
  assert.equal(resolveReference("GGDs", null)?.symbol, "GGD");
  assert.equal(resolveReference("贷款股", "RKT"), null);
});

test("company names resolve through curated aliases, in English and Chinese", () => {
  assert.equal(resolveReference("Google", null)?.symbol, "GOOGL");
  assert.equal(resolveReference("英伟达", null)?.symbol, "NVDA");
  assert.equal(resolveReference("英偉達", null)?.symbol, "NVDA");
  assert.equal(resolveReference("礼来", null)?.symbol, "LLY");
  assert.equal(resolveReference("E.L.F. Beauty", null)?.symbol, "ELF");
  assert.equal(resolveReference("Hims & Hers", null)?.symbol, "HIMS");
  assert.equal(resolveReference("比特币", null)?.symbol, "BTC");
  assert.equal(resolveReference("标普500指数", null)?.market, "index");
  assert.equal(resolveReference("现货黄金", null)?.symbol, "GOLD");
  assert.equal(resolveReference("google", null)?.method, "alias");
});

test("an exact SEC company name resolves without curation", () => {
  const r = resolveReference("American Express Company", null);
  assert.equal(r?.symbol, "AXP");
  assert.equal(resolveReference("Nebius Group", null)?.symbol, "NBIS");
  assert.equal(resolveReference("Legence Corp", null)?.method, "registry_name");
});

test("a model-proposed ticker is kept only when its listed name matches what was said", () => {
  const r = resolveReference("Hims and Hers Health", "hims");
  assert.equal(r?.symbol, "HIMS");
  // A real ticker for a different company is not accepted.
  assert.equal(resolveReference("Vistra Energy", "VST")?.symbol, "VST");
  assert.equal(resolveReference("Celsius", "CELZ")?.symbol, "CELH");
  assert.equal(resolveReference("Some Unknown Miner", "AAPL"), null);
  assert.equal(resolveReference("Nasdaq", "NDAQ"), null);
});

test("sectors, themes and ambiguous names stay unresolved", () => {
  for (const s of ["miners", "energy stocks", "Nasdaq", "纳指", "中小银行", "precious metals", "超微", "Dow", "Lundin", "Target", "Energy"])
    assert.equal(resolveReference(s, null), null, s);
});

test("private companies are identified but never given a ticker", () => {
  const r = resolveReference("Anthropic", null);
  assert.equal(r?.symbol, null);
  assert.equal(r?.market, "private");
  assert.equal(r?.name, "Anthropic");
});

function pick(r: ReturnType<typeof resolveReference>) {
  return r && { symbol: r.symbol, market: r.market, method: r.method, source: r.source };
}
