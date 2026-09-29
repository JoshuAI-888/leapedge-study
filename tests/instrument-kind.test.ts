import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GICS_SECTORS,
  INSTRUMENT_KINDS,
  MACRO_THEMES,
  SECTOR_SUBTHEMES,
  describeInstrument,
  instrumentKind,
  normaliseMacro,
  themeFor,
} from "../src/features/youtube-intelligence/instrument-kind.ts";

test("The vocabulary is fixed: eight macro themes and the eleven GICS sectors", () => {
  assert.deepEqual(
    [...MACRO_THEMES],
    ["Rates", "Inflation", "USD", "Oil", "Gold", "Growth", "Liquidity", "Credit"],
  );
  assert.equal(GICS_SECTORS.length, 11);
  for (const sector of [
    "Energy",
    "Materials",
    "Industrials",
    "Consumer Discretionary",
    "Consumer Staples",
    "Health Care",
    "Financials",
    "Information Technology",
    "Communication Services",
    "Utilities",
    "Real Estate",
  ])
    assert.ok((GICS_SECTORS as readonly string[]).includes(sector), sector);
  // Every sub-theme sits under a real sector.
  for (const sub of SECTOR_SUBTHEMES)
    assert.ok((GICS_SECTORS as readonly string[]).includes(sub.sector), sub.name);
  assert.deepEqual(
    INSTRUMENT_KINDS.map((k) => k.id),
    ["equity", "crypto", "macro", "sector"],
  );
});

test("Rate, inflation, dollar, oil and gold synonyms map to one canonical theme", () => {
  for (const text of [
    "interest rates",
    "Interest Rate",
    "the Fed",
    "Federal Reserve",
    "yields",
    "10-year Treasury yield",
    "rate cuts",
    "美联储",
    "降息",
    "美债收益率",
    "FOMC",
  ])
    assert.equal(normaliseMacro(text), "Rates", text);
  for (const text of ["crude", "WTI", "Brent", "oil prices", "原油", "油价"])
    assert.equal(normaliseMacro(text), "Oil", text);
  for (const text of ["CPI", "inflation", "PCE", "通胀"])
    assert.equal(normaliseMacro(text), "Inflation", text);
  for (const text of ["the dollar", "DXY", "US dollar", "美元指数"])
    assert.equal(normaliseMacro(text), "USD", text);
  for (const text of ["gold", "bullion", "黄金"])
    assert.equal(normaliseMacro(text), "Gold", text);
  for (const text of ["recession", "GDP", "economic growth", "经济衰退"])
    assert.equal(normaliseMacro(text), "Growth", text);
  for (const text of ["liquidity", "QT", "balance sheet runoff", "流动性"])
    assert.equal(normaliseMacro(text), "Liquidity", text);
  for (const text of ["credit spreads", "high yield", "junk bonds", "信用利差"])
    assert.equal(normaliseMacro(text), "Credit", text);
  // Canonical labels map to themselves, case-insensitively.
  for (const theme of MACRO_THEMES) {
    assert.equal(normaliseMacro(theme), theme);
    assert.equal(normaliseMacro(theme.toLowerCase()), theme);
  }
});

test("Sector synonyms map to a GICS sector, with a sub-theme where one is named", () => {
  for (const text of ["semis", "semiconductors", "chip stocks", "半导体", "芯片股"])
    assert.equal(
      normaliseMacro(text),
      "Information Technology / Semiconductors",
      text,
    );
  assert.equal(normaliseMacro("software"), "Information Technology / Software");
  assert.equal(normaliseMacro("tech stocks"), "Information Technology");
  assert.equal(normaliseMacro("regional banks"), "Financials / Banks");
  assert.equal(normaliseMacro("biotech"), "Health Care / Biotechnology");
  assert.equal(normaliseMacro("energy stocks"), "Energy");
  // "oil stocks" is the sector, not the commodity: the longer phrase wins.
  assert.equal(normaliseMacro("oil stocks"), "Energy");
  assert.equal(normaliseMacro("utilities"), "Utilities");
  assert.equal(normaliseMacro("REITs"), "Real Estate");
  assert.equal(normaliseMacro("Information Technology"), "Information Technology");
});

test("Unknown, empty or ambiguous text is not given a theme", () => {
  assert.equal(normaliseMacro(""), null);
  assert.equal(normaliseMacro(null), null);
  assert.equal(normaliseMacro(undefined), null);
  assert.equal(normaliseMacro("NVIDIA"), null);
  assert.equal(normaliseMacro("Acme Corp"), null);
  // Two different themes in one phrase: refuse rather than guess.
  assert.equal(normaliseMacro("gold and oil"), null);
  assert.equal(normaliseMacro("rates and semis"), null);
  // A word inside another word does not match.
  assert.equal(normaliseMacro("Goldman Sachs"), null);
  assert.equal(normaliseMacro("Fedex"), null);
  assert.equal(normaliseMacro("Credo"), null);
  // "high yield" contains "yield" but is Credit, not Rates.
  assert.equal(normaliseMacro("high-yield bonds"), "Credit");
});

test("themeFor splits macro themes from sectors and gives a short display name", () => {
  assert.deepEqual(themeFor("Fed"), {
    kind: "macro",
    canonical: "Rates",
    short: "Rates",
  });
  assert.deepEqual(themeFor("semis"), {
    kind: "sector",
    canonical: "Information Technology / Semiconductors",
    short: "Semis",
  });
  assert.deepEqual(themeFor("energy sector"), {
    kind: "sector",
    canonical: "Energy",
    short: "Energy",
  });
  assert.equal(themeFor("Adobe"), null);
});

test("instrumentKind tells equities, crypto, macro, sectors and unknowns apart", () => {
  assert.equal(instrumentKind({ ticker: "NVDA", instrument: "Nvidia" }), "equity");
  assert.equal(instrumentKind({ ticker: "SPY", instrument: null }), "equity");
  assert.equal(instrumentKind({ ticker: "BTC", instrument: "Bitcoin" }), "crypto");
  assert.equal(instrumentKind({ ticker: "ETH-USD", instrument: null }), "crypto");
  assert.equal(instrumentKind({ ticker: null, instrument: "比特币" }), "crypto");
  assert.equal(instrumentKind({ ticker: null, instrument: "Ethereum" }), "crypto");
  assert.equal(instrumentKind({ ticker: null, instrument: "the Fed" }), "macro");
  assert.equal(instrumentKind({ ticker: null, instrument: "semiconductors" }), "sector");
  // A curated listing resolves a company without a spoken ticker.
  assert.equal(instrumentKind({ ticker: null, instrument: "Nvidia" }), "equity");
  assert.equal(instrumentKind({ ticker: null, instrument: "Acme Corp" }), "unresolved");
  assert.equal(instrumentKind({ ticker: null, instrument: null }), "unresolved");
  // Index-style macro symbols are themes, not stocks.
  assert.equal(instrumentKind({ ticker: "DXY", instrument: null }), "macro");
  assert.equal(instrumentKind({ ticker: "^TNX", instrument: null }), "macro");
  // A theme the model returned wins over the spoken text.
  assert.equal(
    instrumentKind({ ticker: null, instrument: "the central bank", macroTheme: "Rates" }),
    "macro",
  );
  // Snake-case claim fields work too.
  assert.equal(
    instrumentKind({ ticker: null, instrument_as_spoken: "crude oil" }),
    "macro",
  );
  // An unknown model theme is ignored rather than trusted.
  assert.equal(
    instrumentKind({ ticker: null, instrument: "Acme", macroTheme: "Vibes" }),
    "unresolved",
  );
});

test("describeInstrument gives the label text and the Search link", () => {
  assert.deepEqual(describeInstrument({ ticker: "NVDA", instrument: "Nvidia" }), {
    kind: "equity",
    text: "NVDA",
    canonical: "NVDA",
    href: "/youtube-intelligence/search?ticker=NVDA",
    spoken: "Nvidia",
  });
  assert.deepEqual(describeInstrument({ ticker: null, instrument: "yields" }), {
    kind: "macro",
    text: "MACRO · RATES",
    canonical: "Rates",
    href: "/youtube-intelligence/search?kind=macro&instrument=Rates",
    spoken: "yields",
  });
  const semis = describeInstrument({ ticker: null, instrument: "半导体" });
  assert.equal(semis.text, "SECTOR · SEMIS");
  assert.equal(
    semis.href,
    "/youtube-intelligence/search?kind=sector&instrument=Information+Technology+%2F+Semiconductors",
  );
  assert.equal(describeInstrument({ ticker: "BTC-USD", instrument: null }).href,
    "/youtube-intelligence/search?ticker=BTC-USD");
  const listing = describeInstrument({ ticker: null, instrument: "Nvidia" });
  assert.equal(listing.text, "NVDA");
  assert.equal(listing.kind, "equity");
  const unknown = describeInstrument({ ticker: null, instrument: "Acme Corp" });
  assert.deepEqual(unknown, {
    kind: "unresolved",
    text: "Acme Corp",
    canonical: null,
    href: null,
    spoken: "Acme Corp",
  });
  assert.equal(
    describeInstrument({ ticker: null, instrument: null }).text,
    "Unresolved instrument",
  );
});
