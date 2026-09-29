/**
 * Parsed price levels (spec 7.6, F60).
 *
 * The model copies each level's wording verbatim into `value_original`; this
 * module, not the model, turns that text into numbers. It never invents one:
 * anything it cannot read unambiguously — a date, a period, a ratio, mixed
 * multipliers, words between two numbers — returns null, and the UI then
 * shows the original text with a dotted underline instead of a number.
 *
 * Multipliers: k = 1,000, 千 = 1,000, 万 = 10,000, 亿 = 100,000,000.
 * Comparators: above (突破, 以上, 站上, above, over, >), below (跌破, 以下,
 * 低于, below, under, <), near (附近, 左右, 约, around, about, ~), and
 * between for a range. A list ("$50, $100") is several separate targets.
 */
export type LevelComparator = "above" | "below" | "near" | "between";
export type LevelUnit = "price" | "percent" | "points";
export type LevelCurrency = "USD" | "HKD" | "CNY" | "EUR" | "GBP";
export type ParsedLevel = {
  /** The smallest value stated; equal to `high` for a single value. */
  low: number;
  /** The largest value stated. */
  high: number;
  /** Every value, in the order the creator said them. */
  values: number[];
  shape: "point" | "range" | "list";
  currency: LevelCurrency | null;
  comparator: LevelComparator | null;
  unit: LevelUnit;
};

const MAX_LENGTH = 200;
/** A number that is part of a date, period or ratio, not a level. */
const NOT_A_LEVEL =
  /财年|年|季度|月|日|号|周|天|小时|分钟|\bFY\s*\d|\bQ[1-4]\b|\b(?:days?|weeks?|months?|years?|quarters?|hours?|minutes?|yrs?)\b|\d\s*:\s*\d/i;
const NUMBER =
  /(?<![\p{Script=Latin}\p{N}.])(HK\$|US\$|\$|€|£|¥)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(万亿|万|亿|千|[kK]))?\s*(%)?(?![\p{Script=Latin}\p{N}])/gu;
const MULTIPLIER: Record<string, number> = {
  k: 1e3,
  K: 1e3,
  千: 1e3,
  万: 1e4,
  亿: 1e8,
  万亿: 1e12,
};
const SYMBOL_CURRENCY: Record<string, LevelCurrency | "ambiguous"> = {
  $: "USD",
  US$: "USD",
  HK$: "HKD",
  "€": "EUR",
  "£": "GBP",
  // ¥ is both yen and yuan.
  "¥": "ambiguous",
};
const WORD_CURRENCY: [RegExp, LevelCurrency][] = [
  [/美元|美金|\bUSD\b|\bdollars?\b/i, "USD"],
  [/港元|港币|\bHKD\b/i, "HKD"],
  [/人民币|\bRMB\b|\bCNY\b/i, "CNY"],
  [/欧元|\bEUR\b/i, "EUR"],
  [/英镑|\bGBP\b/i, "GBP"],
];
const ABOVE =
  /突破|以上|站上|站稳|高于|超过|\babove\b|\bover\b|\bbreaks?\s+out\b|>|≥/i;
const BELOW = /跌破|以下|低于|破位|\bbelow\b|\bunder\b|<|≤/i;
const NEAR = /附近|左右|大约|约|\baround\b|\babout\b|\bnear\b|\bapprox(?:imately)?\b|^~/i;
const RANGE_SEPARATOR = /^(?:到|至|-|–|—|~|～|to|and)$/i;
const LIST_SEPARATOR = /^(?:、|,|or|或|和|;)$/i;

type Token = {
  start: number;
  end: number;
  symbol: string | null;
  value: number;
  multiplier: string | null;
  percent: boolean;
};

export function parseLevel(value_original: string): ParsedLevel | null {
  if (typeof value_original !== "string") return null;
  // Keep the full-width comma apart from the thousands comma before NFKC
  // folds them together: "50，60" is a list, "50,000" is one number.
  const text = value_original
    .replace(/，/g, "、")
    .normalize("NFKC")
    .trim();
  if (!text || text.length > MAX_LENGTH || NOT_A_LEVEL.test(text)) return null;
  const tokens: Token[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const value = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(value)) return null;
    tokens.push({
      start: m.index!,
      end: m.index! + m[0].length,
      symbol: m[1] ?? null,
      value,
      multiplier: m[3] ?? null,
      percent: m[4] === "%",
    });
  }
  if (!tokens.length) return null;
  // What sits between two numbers decides range or list; anything else is
  // ambiguous ("entry 50 target 60", "50/100", "1,23").
  let shape: ParsedLevel["shape"] = "point";
  for (let i = 1; i < tokens.length; i++) {
    const between = text
      .slice(tokens[i - 1].end, tokens[i].start)
      .replace(/附近|左右/g, "")
      .trim();
    const next = RANGE_SEPARATOR.test(between)
      ? "range"
      : LIST_SEPARATOR.test(between)
        ? "list"
        : null;
    if (!next) return null;
    // "50 and 60" is a list unless the creator said "between".
    const resolved =
      next === "range" && /^and$/i.test(between) && !/\bbetween\b|介于/i.test(text)
        ? "list"
        : next;
    if (shape !== "point" && shape !== resolved) return null;
    shape = resolved;
  }
  // A list separator must be a real one: a bare comma between digits ("1,23")
  // is neither a thousands group nor a list.
  for (let i = 1; i < tokens.length; i++)
    if (text.slice(tokens[i - 1].end, tokens[i].start) === ",") return null;
  if (shape === "range" && tokens.length !== 2) return null;
  // Multipliers must agree: "7.5-8万" could be 7.5 or 75,000.
  const multipliers = new Set(tokens.map((t) => t.multiplier));
  if (multipliers.size > 1) return null;
  const factor = MULTIPLIER[tokens[0].multiplier ?? ""] ?? 1;
  // A percent sign on the last value applies to the range ("20-30%").
  const percents = tokens.filter((t) => t.percent).length;
  if (percents > 0 && percents < tokens.length && !tokens.at(-1)!.percent)
    return null;
  const unit: LevelUnit =
    percents > 0 ? "percent" : /点|\bpoints?\b|\bpts\b/i.test(text) ? "points" : "price";
  // Currency: one symbol or word, never two different ones.
  const currencies = new Set<string>();
  for (const t of tokens)
    if (t.symbol) currencies.add(SYMBOL_CURRENCY[t.symbol] ?? "ambiguous");
  for (const [pattern, currency] of WORD_CURRENCY)
    if (pattern.test(text)) currencies.add(currency);
  if (currencies.size > 1) return null;
  const only = [...currencies][0];
  const currency: LevelCurrency | null =
    unit === "percent" || !only || only === "ambiguous" ? null : (only as LevelCurrency);
  if (only === "ambiguous" && tokens.length > 1) return null;
  // An explicit sign counts only at the very start: "-15%", never "340-322".
  const sign = /^[-−]/.test(text) && tokens.length === 1 ? -1 : 1;
  const values = tokens.map((t) => roundSafe(sign * t.value * factor));
  const above = ABOVE.test(text),
    below = BELOW.test(text);
  const comparator: LevelComparator | null =
    shape === "range"
      ? "between"
      : shape === "list"
        ? null
        : above && below
          ? null
          : above
            ? "above"
            : below
              ? "below"
              : NEAR.test(text)
                ? "near"
                : null;
  if (shape !== "point" && above && below) return null;
  return {
    low: Math.min(...values),
    high: Math.max(...values),
    values,
    shape,
    currency,
    comparator,
    unit,
  };
}
/** Undo binary floating error from multiplying ("1.2k" is 1200, not 1200.0000000000002). */
function roundSafe(n: number) {
  return Number(n.toPrecision(12));
}

const PREFIX: Record<LevelCurrency, string> = {
  USD: "$",
  HKD: "HK$",
  CNY: "CN¥",
  EUR: "€",
  GBP: "£",
};
/** A parsed level in plain words: "above 724.32", "83,000–85,400", "$50 · $100". */
export function formatLevel(level: ParsedLevel): string {
  const one = (n: number) => {
    const digits = n.toLocaleString("en-US", { maximumFractionDigits: 6 });
    const money = level.currency ? PREFIX[level.currency] : "";
    return level.unit === "percent"
      ? `${digits}%`
      : `${money}${digits}${level.unit === "points" ? " pts" : ""}`;
  };
  if (level.shape === "range") return `${one(level.low)}–${one(level.high)}`;
  if (level.shape === "list") return level.values.map(one).join(" · ");
  return level.comparator ? `${level.comparator} ${one(level.low)}` : one(level.low);
}

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Days until a call's expiry date, counted in calendar days from `today`
 * (both YYYY-MM-DD). "soon" is within 7 days, "expired" once past. Null when
 * either date is missing or not a real calendar date.
 */
export function expiryStatus(
  date: string | null | undefined,
  today: string,
): { days: number; state: "open" | "soon" | "expired" } | null {
  if (!date || !ISO_DATE.test(date) || !ISO_DATE.test(today)) return null;
  const end = Date.parse(`${date}T00:00:00Z`),
    now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(now)) return null;
  if (new Date(end).toISOString().slice(0, 10) !== date) return null;
  const days = Math.round((end - now) / DAY_MS);
  return { days, state: days < 0 ? "expired" : days <= 7 ? "soon" : "open" };
}
