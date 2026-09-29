import { resolveListing } from "./identity.ts";
/**
 * Instrument kinds and the macro / sector vocabulary (spec 7.6, F59).
 *
 * A call is about a ticker, a crypto asset, a macro theme or a sector. Macro
 * themes and sectors come from a FIXED vocabulary so that grouping is stable:
 * free text would split "rates" and "interest rates" into two rows.
 *
 * Sectors are the eleven GICS sectors. Where the creator names something
 * narrower that analysts group on (semis, banks, biotech), the canonical label
 * is "<GICS sector> / <sub-theme>", e.g. "Information Technology /
 * Semiconductors". The sector prefix keeps every sub-theme rolling up to
 * exactly one GICS sector, and the sub-theme list is fixed below, so a
 * consumer can group by either the full label or the part before " / ".
 *
 * Matching is deliberately strict. A phrase matches only when the WHOLE text
 * is the theme, apart from filler such as "the", "stocks" or "板块": "Bank of
 * America" is not the Banks sector and "Goldman Sachs" is not Gold. When two
 * different themes match ("gold and oil") nothing is returned. A longer
 * phrase wins over a phrase inside it, so "oil stocks" is the Energy sector,
 * "high yield" is Credit and "central bank" is Rates. Never a guess: an
 * unknown or ambiguous name stays unresolved.
 */
export const MACRO_THEMES = [
  "Rates",
  "Inflation",
  "USD",
  "Oil",
  "Gold",
  "Growth",
  "Liquidity",
  "Credit",
] as const;
export type MacroTheme = (typeof MACRO_THEMES)[number];
export const GICS_SECTORS = [
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
] as const;
export type GicsSector = (typeof GICS_SECTORS)[number];
/** Short names for the instrument label ("SECTOR · TECH"). */
const SECTOR_SHORT: Record<GicsSector, string> = {
  Energy: "Energy",
  Materials: "Materials",
  Industrials: "Industrials",
  "Consumer Discretionary": "Discretionary",
  "Consumer Staples": "Staples",
  "Health Care": "Health Care",
  Financials: "Financials",
  "Information Technology": "Tech",
  "Communication Services": "Communications",
  Utilities: "Utilities",
  "Real Estate": "Real Estate",
};
/** The fixed sub-themes, each under exactly one GICS sector. */
export const SECTOR_SUBTHEMES: readonly {
  sector: GicsSector;
  name: string;
  short: string;
  synonyms: readonly string[];
}[] = [
  {
    sector: "Information Technology",
    name: "Semiconductors",
    short: "Semis",
    synonyms: ["semis", "semiconductor", "semiconductors", "chip", "chips", "chipmakers", "chip stocks", "半导体", "芯片", "芯片股"],
  },
  {
    sector: "Information Technology",
    name: "Software",
    short: "Software",
    synonyms: ["software", "saas", "软件", "软件股"],
  },
  {
    sector: "Financials",
    name: "Banks",
    short: "Banks",
    synonyms: ["banks", "bank stocks", "regional banks", "big banks", "银行", "银行股"],
  },
  {
    sector: "Financials",
    name: "Insurance",
    short: "Insurance",
    synonyms: ["insurers", "insurance", "保险", "保险股"],
  },
  {
    sector: "Health Care",
    name: "Biotechnology",
    short: "Biotech",
    synonyms: ["biotech", "biotechnology", "biotechs", "生物科技", "生物技术"],
  },
  {
    sector: "Health Care",
    name: "Pharmaceuticals",
    short: "Pharma",
    synonyms: ["pharma", "pharmaceuticals", "drugmakers", "制药", "药企"],
  },
  {
    sector: "Industrials",
    name: "Aerospace & Defense",
    short: "Defense",
    synonyms: ["defense", "defence", "defense stocks", "aerospace", "aerospace and defense", "军工", "国防"],
  },
  {
    sector: "Industrials",
    name: "Airlines",
    short: "Airlines",
    synonyms: ["airlines", "airline stocks", "航空股"],
  },
  {
    sector: "Consumer Discretionary",
    name: "Retail",
    short: "Retail",
    synonyms: ["retail", "retailers", "零售", "零售股"],
  },
  {
    sector: "Consumer Discretionary",
    name: "Automobiles",
    short: "Autos",
    synonyms: ["autos", "automakers", "car makers", "carmakers", "汽车股"],
  },
  {
    sector: "Consumer Discretionary",
    name: "Homebuilders",
    short: "Homebuilders",
    synonyms: ["homebuilders", "housing stocks", "房地产开发商"],
  },
  {
    sector: "Materials",
    name: "Metals & Mining",
    short: "Mining",
    synonyms: ["miners", "mining", "mining stocks", "gold miners", "metals and mining", "矿业", "矿业股"],
  },
];
const SECTOR_SYNONYMS: Record<GicsSector, readonly string[]> = {
  Energy: ["energy", "energy stocks", "oil stocks", "oil and gas", "oil majors", "能源", "能源股", "石油股"],
  Materials: ["materials", "basic materials", "chemicals", "材料", "原材料"],
  Industrials: ["industrials", "industrial", "工业", "工业股"],
  "Consumer Discretionary": ["consumer discretionary", "discretionary", "可选消费"],
  "Consumer Staples": ["consumer staples", "staples", "必需消费", "必选消费"],
  "Health Care": ["health care", "healthcare", "医疗", "医药", "医疗保健"],
  Financials: ["financials", "financial stocks", "金融", "金融股"],
  "Information Technology": ["information technology", "tech", "technology", "科技", "科技股"],
  "Communication Services": ["communication services", "communications", "telecom", "telecoms", "通信"],
  Utilities: ["utilities", "utility stocks", "公用事业"],
  "Real Estate": ["real estate", "reits", "reit", "房地产", "地产股"],
};
const MACRO_SYNONYMS: Record<MacroTheme, readonly string[]> = {
  Rates: [
    "interest rate", "interest rates", "rates", "rate cut", "rate cuts",
    "rate hike", "rate hikes", "fed", "the fed", "federal reserve", "fomc",
    "powell", "central bank", "yield", "yields", "bond yield", "bond yields",
    "treasury", "treasuries", "treasury yield", "treasury yields",
    "利率", "加息", "降息", "美联储", "联储", "美债", "国债", "收益率", "央行",
  ],
  Inflation: ["inflation", "cpi", "pce", "ppi", "core inflation", "通胀", "通货膨胀", "物价"],
  USD: ["dollar", "us dollar", "usd", "dxy", "dollar index", "greenback", "美元", "美元指数"],
  Oil: ["oil", "crude", "crude oil", "wti", "brent", "oil price", "oil prices", "原油", "石油", "油价"],
  Gold: ["gold", "bullion", "gold price", "xau", "黄金", "金价"],
  Growth: [
    "gdp", "recession", "economic growth", "economy", "the economy",
    "soft landing", "hard landing", "经济", "衰退", "经济增长", "经济衰退",
  ],
  Liquidity: [
    "liquidity", "qt", "qe", "quantitative tightening", "quantitative easing",
    "balance sheet", "balance sheet runoff", "money supply", "m2",
    "流动性", "缩表", "扩表", "放水",
  ],
  Credit: [
    "credit", "credit spreads", "credit spread", "high yield", "junk bonds",
    "private credit", "corporate bonds", "信用", "信贷", "信用利差", "高收益债",
  ],
};
/** Phrases that look like a theme but are not one; they block a match. */
const NOT_A_THEME = ["growth stocks", "growth stock", "成长股", "bank of", "tech giants"];
/** Words that may surround a theme without changing it. */
const FILLER = new Set([
  "the", "a", "an", "us", "u", "s", "and", "sector", "sectors", "stocks",
  "stock", "names", "industry", "space", "market", "markets", "prices",
  "price", "index", "bonds", "bond", "year", "yr", "term", "long", "short",
  "outlook", "trade", "play", "plays", "theme", "etf", "etfs", "group",
]);
const CJK_FILLER = ["板块", "行业", "指数", "价格", "市场", "走势", "股", "的"];

type Theme = {
  kind: "macro" | "sector";
  canonical: string;
  short: string;
};
type Entry = { phrase: string; theme: Theme | null };

function normaliseText(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[‐-―\-_/.,'’()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const THEME_ENTRIES: Entry[] = (() => {
  const entries: Entry[] = [];
  const add = (phrases: readonly string[], theme: Theme | null) => {
    for (const p of phrases) entries.push({ phrase: normaliseText(p), theme });
  };
  for (const theme of MACRO_THEMES)
    add([theme, ...MACRO_SYNONYMS[theme]], {
      kind: "macro",
      canonical: theme,
      short: theme,
    });
  for (const sector of GICS_SECTORS)
    add([sector, ...SECTOR_SYNONYMS[sector]], {
      kind: "sector",
      canonical: sector,
      short: SECTOR_SHORT[sector],
    });
  for (const sub of SECTOR_SUBTHEMES)
    add([sub.name, ...sub.synonyms], {
      kind: "sector",
      canonical: `${sub.sector} / ${sub.name}`,
      short: sub.short,
    });
  add(NOT_A_THEME, null);
  return entries;
})();
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * The value every entry covering the whole text agrees on: undefined when no
 * entry covers it, null when entries disagree or a blocking phrase wins.
 */
function matchWhole<T>(
  raw: string | null | undefined,
  entries: { phrase: string; theme: T | null }[],
  key: (value: T) => string,
): T | null | undefined {
  if (!raw) return undefined;
  const text = normaliseText(raw);
  if (!text) return undefined;
  const hits: { start: number; end: number; theme: T | null }[] = [];
  for (const e of entries) {
    if (!e.phrase) continue;
    const pattern = CJK.test(e.phrase)
      ? new RegExp(escape(e.phrase), "gu")
      : new RegExp(`(?<![\\p{L}\\p{N}])${escape(e.phrase)}(?![\\p{L}\\p{N}])`, "gu");
    for (const m of text.matchAll(pattern))
      hits.push({ start: m.index!, end: m.index! + m[0].length, theme: e.theme });
  }
  if (!hits.length) return undefined;
  // A phrase inside a longer matched phrase gives way to it.
  const kept = hits.filter(
    (h) =>
      !hits.some(
        (o) =>
          o !== h &&
          o.start <= h.start &&
          o.end >= h.end &&
          o.end - o.start > h.end - h.start,
      ),
  );
  // Whatever no phrase covers must be filler, or the text names something else.
  const covered = new Array<boolean>(text.length).fill(false);
  for (const h of kept) for (let i = h.start; i < h.end; i++) covered[i] = true;
  let rest = text.split("").map((c, i) => (covered[i] ? " " : c)).join("");
  for (const f of CJK_FILLER) rest = rest.split(f).join(" ");
  const leftovers = rest.split(/\s+/).filter(Boolean);
  if (leftovers.some((w) => !FILLER.has(w) && !/^\d+$/.test(w))) return undefined;
  if (kept.some((h) => h.theme === null)) return null;
  const distinct = new Map(kept.map((h) => [key(h.theme as T), h.theme as T]));
  return distinct.size === 1 ? [...distinct.values()][0] : null;
}
/** The macro theme or sector a phrase names, or null. */
export function themeFor(text: string | null | undefined): Theme | null {
  return matchWhole(text, THEME_ENTRIES, (t) => t.canonical) ?? null;
}
/**
 * The canonical vocabulary label for a phrase: a macro theme ("Rates"), a
 * GICS sector ("Energy") or a sector sub-theme ("Information Technology /
 * Semiconductors"). Null when the phrase is not one, or is ambiguous.
 */
export function normaliseMacro(text: string | null | undefined): string | null {
  return themeFor(text)?.canonical ?? null;
}

/** Crypto assets by the symbol the label shows. */
const CRYPTO_NAMES: Record<string, readonly string[]> = {
  BTC: ["bitcoin", "btc", "比特币", "大饼"],
  ETH: ["ethereum", "ether", "eth", "以太坊", "以太币"],
  SOL: ["solana", "索拉纳"],
  XRP: ["ripple", "xrp", "瑞波币"],
  DOGE: ["dogecoin", "doge", "狗狗币"],
  CRYPTO: ["crypto", "cryptocurrency", "cryptocurrencies", "加密货币", "虚拟货币", "币圈"],
};
const CRYPTO_ENTRIES = Object.entries(CRYPTO_NAMES).flatMap(([symbol, names]) =>
  names.map((n) => ({ phrase: normaliseText(n), theme: symbol })),
);
/**
 * Bare symbols read as crypto. SOL and LINK are left out on purpose: both are
 * also US-listed equities, so they count as crypto only with a -USD suffix.
 */
const CRYPTO_TICKERS = new Set([
  "BTC", "ETH", "XRP", "DOGE", "ADA", "BNB", "AVAX", "LTC", "SHIB", "USDT",
  "USDC", "BCH", "XLM", "TRX", "PEPE", "SUI", "TON", "DOT",
]);
/** Index and futures symbols that stand for a macro theme, not a stock. */
const MACRO_SYMBOLS: Record<string, MacroTheme> = {
  DXY: "USD",
  "^DXY": "USD",
  "DX-Y.NYB": "USD",
  "^TNX": "Rates",
  TNX: "Rates",
  "^TYX": "Rates",
  "^FVX": "Rates",
  "^IRX": "Rates",
  US10Y: "Rates",
  US02Y: "Rates",
  US2Y: "Rates",
  "CL=F": "Oil",
  "BZ=F": "Oil",
  WTI: "Oil",
  BRENT: "Oil",
  USOIL: "Oil",
  "GC=F": "Gold",
  XAU: "Gold",
  XAUUSD: "Gold",
};
function cryptoTicker(ticker: string) {
  const t = ticker.trim().toUpperCase();
  const pair = /^([A-Z0-9]{2,10})[-/]?(USD|USDT|USDC)$/.exec(t);
  if (pair && pair[1] !== "") {
    if (CRYPTO_TICKERS.has(pair[1]) || ["SOL", "LINK"].includes(pair[1]))
      return true;
  }
  return CRYPTO_TICKERS.has(t);
}

export type InstrumentKind = "equity" | "crypto" | "macro" | "sector" | "unresolved";
/** The Type filter options, in the order the requirements list them. */
export const INSTRUMENT_KINDS: readonly { id: Exclude<InstrumentKind, "unresolved">; label: string }[] = [
  { id: "equity", label: "Stocks & ETFs" },
  { id: "crypto", label: "Crypto" },
  { id: "macro", label: "Macro" },
  { id: "sector", label: "Sector" },
];
/** Any claim-shaped value: a ClaimRow, a model claim or a mention. */
export type ClaimLike = {
  ticker?: string | null;
  instrument?: string | null;
  instrument_as_spoken?: string | null;
  macroTheme?: string | null;
  macro_theme?: string | null;
};
export type InstrumentDescription = {
  kind: InstrumentKind;
  /** What the label shows: "NVDA", "MACRO · RATES", or the spoken name. */
  text: string;
  /** The grouping key: ticker, crypto symbol or vocabulary label. */
  canonical: string | null;
  /** Search for this instrument, or null when there is nothing to search. */
  href: string | null;
  /** The instrument as the creator said it, when recorded. */
  spoken: string | null;
};
const SEARCH = "/youtube-intelligence/search";
function themeDescription(theme: Theme, spoken: string | null): InstrumentDescription {
  const params = new URLSearchParams({ kind: theme.kind, instrument: theme.canonical });
  return {
    kind: theme.kind,
    text: `${theme.kind === "macro" ? "MACRO" : "SECTOR"} · ${theme.short.toUpperCase()}`,
    canonical: theme.canonical,
    href: `${SEARCH}?${params}`,
    spoken,
  };
}
function tickerDescription(kind: "equity" | "crypto", ticker: string, spoken: string | null): InstrumentDescription {
  return {
    kind,
    text: ticker,
    canonical: ticker,
    href: `${SEARCH}?${new URLSearchParams({ ticker })}`,
    spoken,
  };
}
/** Everything the instrument label needs, from any claim-shaped value. */
export function describeInstrument(claim: ClaimLike): InstrumentDescription {
  const spoken = (claim.instrument ?? claim.instrument_as_spoken ?? null)?.trim() || null;
  const ticker = claim.ticker?.trim() || null;
  const modelTheme = themeFor(claim.macroTheme ?? claim.macro_theme);
  if (modelTheme) return themeDescription(modelTheme, spoken);
  if (ticker) {
    const macro = MACRO_SYMBOLS[ticker.toUpperCase()];
    if (macro)
      return themeDescription({ kind: "macro", canonical: macro, short: macro }, spoken);
    return tickerDescription(cryptoTicker(ticker) ? "crypto" : "equity", ticker, spoken);
  }
  if (spoken) {
    const crypto = matchWhole(spoken, CRYPTO_ENTRIES, (s) => s);
    if (crypto && crypto !== "CRYPTO") return tickerDescription("crypto", crypto, spoken);
    if (crypto === "CRYPTO")
      return {
        kind: "crypto",
        text: "CRYPTO",
        canonical: "Crypto",
        href: `${SEARCH}?${new URLSearchParams({ kind: "crypto" })}`,
        spoken,
      };
    const listing = resolveListing(spoken, null);
    if (listing) return tickerDescription("equity", listing.ticker, spoken);
    const theme = themeFor(spoken);
    if (theme) return themeDescription(theme, spoken);
  }
  return {
    kind: "unresolved",
    text: spoken ?? "Unresolved instrument",
    canonical: null,
    href: null,
    spoken,
  };
}
/** 'equity' | 'crypto' | 'macro' | 'sector' | 'unresolved'. */
export function instrumentKind(claim: ClaimLike): InstrumentKind {
  return describeInstrument(claim).kind;
}
