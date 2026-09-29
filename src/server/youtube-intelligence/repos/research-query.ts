import { z } from "zod";
import { database, iso } from "../database.ts";
import {
  Claim,
  SENTIMENTS,
  type SentimentData,
} from "../../../features/youtube-intelligence/contracts.ts";
import { STANCE_SENTIMENT } from "../../../features/youtube-intelligence/sentiment.ts";
/**
 * F56: paged, server-side queries over calls (the `claims` table) and videos
 * (runs), so a surface never has to read the capped workspace snapshot to
 * answer "how many" or "which". Every total is an exact COUNT, every page is
 * bounded, and nothing is trimmed without saying so.
 *
 * Postgres dialect with $n placeholders; PGlite runs the same statements.
 *
 * Definitions used throughout:
 * - A call's date is `published_at`, falling back to `created_at` when the
 *   video's publish time was never recorded.
 * - A call's instrument key is its ticker, or the spoken instrument when there
 *   is no ticker (macro themes, sectors, unresolved names).
 * - Sentiment is derived from stance by the same table the pipeline uses
 *   (`STANCE_SENTIMENT`); `conditional` has no direction on a stored call and
 *   grades neutral, exactly as `sentimentFromStance` does without one.
 * - Canonical runs are the ones the snapshot shows: completed, not a task, and
 *   either the run a `publication` names for its video or, without one, the
 *   newest non-experimental completed run of the video.
 */
export const STANCES = Claim.shape.stance.options;
export const CONVICTIONS = Claim.shape.creator_conviction.options;
export const TRUST_LEVELS = ["L0", "L1", "L2", "L3"] as const;
export const INSTRUMENT_KINDS = [
  "stock",
  "crypto",
  "macro",
  "sector",
  "unresolved",
] as const;
export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];
export const MAX_PAGE = 100;

// ---------------------------------------------------------------------------
// Instrument kind. The extraction lane (F59) owns the fixed vocabulary in
// `features/youtube-intelligence/instrument-kind.ts`; until that lands the kind
// is derived here from what a stored call already carries. Point
// `instrumentKind` at that module when it exists: every query goes through it.
// ---------------------------------------------------------------------------
const CRYPTO_TICKER =
  /^(BTC|ETH|SOL|XRP|DOGE|ADA|BNB|AVAX|DOT|LINK|LTC|TRX|TON|SHIB|MATIC|USDT|USDC)(-?USDT?|-?USD|-?USDC)?$/;
const CRYPTO_NAME =
  /\b(bitcoin|ethereum|ether|solana|crypto(currenc(y|ies))?|altcoins?|dogecoin|stablecoins?)\b/i;
const MACRO_TICKER = /(=F|=X)$|^\^(TNX|TYX|FVX|IRX|VIX|DXY)$|^DX-Y\.NYB$/;
const MACRO_NAME =
  /\b(rates?|yields?|treasur(y|ies)|bonds?|fed|federal reserve|fomc|inflation|cpi|pce|deflation|usd|dollar|dxy|currenc(y|ies)|fx|oil|crude|brent|wti|gold|silver|commodit(y|ies)|growth|gdp|recession|economy|liquidity|credit|spreads?|jobs|labou?r market|unemployment)\b/i;
const SECTOR_NAME =
  /\b(sector|energy|materials|industrials|consumer discretionary|consumer staples|health ?care|financials|banks|information technology|tech(nology)? stocks|communication services|utilities|real estate|reits?|semiconductors?|semis|biotech)\b/i;
export function instrumentKind(
  ticker: string | null,
  instrument: string | null,
): InstrumentKind {
  const symbol = ticker?.trim().toUpperCase() || null;
  const name = instrument?.trim() || "";
  if ((symbol && CRYPTO_TICKER.test(symbol)) || CRYPTO_NAME.test(name))
    return "crypto";
  if (symbol && MACRO_TICKER.test(symbol)) return "macro";
  if (symbol) return "stock";
  if (/\bsector\b/i.test(name)) return "sector";
  if (MACRO_NAME.test(name)) return "macro";
  if (SECTOR_NAME.test(name)) return "sector";
  return "unresolved";
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const DateBound = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const FILTER_SHAPE = {
  /** Tickers or spoken instrument names, matched case-insensitively. */
  instruments: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  kinds: z.array(z.enum(INSTRUMENT_KINDS)).max(5).optional(),
  channels: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  stances: z.array(z.enum(STANCES)).max(7).optional(),
  sentiments: z.array(z.enum(SENTIMENTS)).max(3).optional(),
  convictions: z.array(z.enum(CONVICTIONS)).max(4).optional(),
  minTrust: z.enum(TRUST_LEVELS).optional(),
  /**
   * Published-date window. A date (YYYY-MM-DD) is a whole UTC day and both ends
   * are inclusive; an instant is exact, `from` inclusive and `to` exclusive, so
   * a caller that has already mapped a trading session to instants passes them
   * straight through.
   */
  from: DateBound.optional(),
  to: DateBound.optional(),
  /** Case-insensitive substring over title, thesis, instrument, quote and translation. */
  text: z.string().max(200).optional(),
  pinnedOnly: z.boolean().default(false),
  canonicalOnly: z.boolean().default(true),
};
type FilterInput = z.output<z.ZodObject<typeof FILTER_SHAPE>>;
function withFilters<S extends Record<string, z.ZodType>>(extra: S) {
  return z.preprocess(
    (v) => v ?? {},
    z
      .strictObject({ ...FILTER_SHAPE, ...extra })
      .refine((v) => windowIsOrdered(v as { from?: string; to?: string }), {
        message: "The window starts after it ends.",
        path: ["from"],
      }),
  );
}
const Paging = {
  limit: z.number().int().min(1).max(MAX_PAGE).default(50),
  offset: z.number().int().min(0).max(1_000_000).default(0),
};
export const CallsQuery = withFilters({
  ...Paging,
  sort: z.enum(["newest", "conviction", "trust"]).default("newest"),
});
export const VideosQuery = withFilters({
  ...Paging,
  sort: z.enum(["newest", "ideas"]).default("newest"),
});
export const SeriesQuery = withFilters({
  bucket: z.enum(["day", "week"]).default("week"),
  pointCap: z.number().int().min(0).max(5000).default(1000),
});
export const SearchIndexQuery = z.preprocess(
  (v) => v ?? {},
  z.strictObject({
    instruments: z.number().int().min(1).max(2000).default(500),
    videos: z.number().int().min(1).max(1000).default(200),
  }),
);
function windowIsOrdered(v: { from?: string; to?: string }) {
  return !v.from || !v.to || lower(v.from) <= upper(v.to);
}
/** The inclusive lower instant of a bound. */
function lower(bound: string) {
  return bound.length === 10
    ? `${bound}T00:00:00.000Z`
    : new Date(bound).toISOString();
}
/** The exclusive upper instant of a bound: a date covers its whole UTC day. */
function upper(bound: string) {
  if (bound.length !== 10) return new Date(bound).toISOString();
  const next = new Date(`${bound}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
/** An ILIKE pattern that matches `text` literally anywhere in a value. */
export function likePattern(text: string) {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ---------------------------------------------------------------------------
// SQL building
// ---------------------------------------------------------------------------
function quote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}
/** Stance → sentiment as SQL, generated from the pipeline's own table. */
function sentimentSql(stance: string) {
  const arms = Object.entries(STANCE_SENTIMENT)
    .filter(([, s]) => s !== null)
    .map(([k, s]) => `WHEN ${quote(k)} THEN ${quote(s!)}`)
    .join(" ");
  return `(CASE ${stance} ${arms} ELSE 'neutral' END)`;
}
const CONVICTION_RANK = `(CASE c.creator_conviction WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END)`;
/**
 * The canonical run ids, as the snapshot's canonicalRuns() selects them. It
 * reads only `input` (a small document) and the publication rows, never the
 * run output.
 */
const CANONICAL = `SELECT DISTINCT ON (r.video_id) r.id
  FROM yi_runs r
  LEFT JOIN yi_documents p ON p.kind='publication' AND p.id=r.video_id
  WHERE r.status='completed' AND (r.input::jsonb->>'task') IS NULL
    AND CASE WHEN p.id IS NOT NULL THEN (p.payload::jsonb->>'runId')=r.id
      ELSE COALESCE(r.input::jsonb->>'experiment','false')<>'true' END
  ORDER BY r.video_id, r.created_at DESC, r.id DESC`;
const PINNED = `SELECT upper(id) FROM yi_documents WHERE kind='watchlist' AND (payload::jsonb->>'enabled')='true'`;
const KEY = (a: string) => `COALESCE(${a}.ticker,${a}.instrument)`;
const AT = (a: string) => `COALESCE(${a}.published_at,${a}.created_at)`;
const PAIR = (a: string) =>
  `(COALESCE(${a}.ticker,'') || chr(31) || COALESCE(${a}.instrument,''))`;
const pairKey = (ticker: string | null, instrument: string | null) =>
  `${ticker ?? ""}\u001f${instrument ?? ""}`;

type Facet =
  | "instrument"
  | "kind"
  | "channel"
  | "stance"
  | "sentiment"
  | "conviction"
  | "trust";
function params() {
  const values: unknown[] = [];
  return {
    values,
    add(value: unknown) {
      values.push(value);
      return `$${values.length}`;
    },
  };
}
type Params = ReturnType<typeof params>;
type Resolved = FilterInput & {
  text?: string;
  /** Instrument pair keys the kinds filter admits, resolved once per request. */
  kindPairs?: string[];
};
/**
 * The conditions a call must meet, over the claims alias `a`. `titleSql` is the
 * video title expression when the title belongs to the text match; `skip` drops
 * one facet's own filter; `callOnly` leaves out channel and window, which the
 * videos query applies to the run instead.
 */
function callConditions(
  f: Resolved,
  p: Params,
  a: string,
  o: { skip?: Facet; titleSql?: string; callOnly?: boolean; noText?: boolean } = {},
) {
  const where: string[] = [];
  if (f.canonicalOnly) where.push(`${a}.run_id IN (SELECT id FROM canon)`);
  if (f.instruments?.length && o.skip !== "instrument")
    where.push(
      `upper(${KEY(a)}) = ANY(${p.add(f.instruments.map((i) => i.toUpperCase()))}::text[])`,
    );
  if (f.kindPairs && o.skip !== "kind")
    where.push(`${PAIR(a)} = ANY(${p.add(f.kindPairs)}::text[])`);
  if (f.channels?.length && o.skip !== "channel" && !o.callOnly)
    where.push(`${a}.channel_id = ANY(${p.add(f.channels)}::text[])`);
  if (f.stances?.length && o.skip !== "stance")
    where.push(`${a}.stance = ANY(${p.add(f.stances)}::text[])`);
  if (f.sentiments?.length && o.skip !== "sentiment")
    where.push(`${sentimentSql(`${a}.stance`)} = ANY(${p.add(f.sentiments)}::text[])`);
  if (f.convictions?.length && o.skip !== "conviction")
    where.push(`${a}.creator_conviction = ANY(${p.add(f.convictions)}::text[])`);
  if (f.minTrust && f.minTrust !== "L0" && o.skip !== "trust")
    where.push(`${a}.trust_level >= ${p.add(f.minTrust)}`);
  if (f.pinnedOnly) where.push(`upper(${a}.ticker) IN (${PINNED})`);
  if (!o.callOnly) {
    if (f.from) where.push(`${AT(a)} >= ${p.add(lower(f.from))}::timestamptz`);
    if (f.to) where.push(`${AT(a)} < ${p.add(upper(f.to))}::timestamptz`);
  }
  if (f.text && !o.noText) where.push(callText(a, p.add(likePattern(f.text)), o.titleSql));
  return where;
}
function callText(a: string, pattern: string, titleSql?: string) {
  const title = titleSql === undefined ? "" : `${titleSql} ILIKE ${pattern} OR `;
  return `(${title}${a}.thesis_en ILIKE ${pattern}
    OR ${a}.ticker ILIKE ${pattern} OR ${a}.instrument ILIKE ${pattern}
    OR EXISTS (SELECT 1 FROM evidence_spans s WHERE s.claim_id=${a}.id
      AND (s.text_original ILIKE ${pattern} OR s.translation_en ILIKE ${pattern})))`;
}
const and = (where: string[]) => (where.length ? where.join(" AND ") : "TRUE");
/** The calls FROM clause: the run title is joined for the text match and the row. */
const CALLS_FROM = `FROM claims c LEFT JOIN yi_runs r ON r.id=c.run_id`;
function withCanon(f: Resolved, sql: string) {
  return f.canonicalOnly ? `WITH canon AS MATERIALIZED (${CANONICAL}) ${sql}` : sql;
}
async function rows(sql: string, values: unknown[]) {
  return (await database.prepare(sql).all(...values)) as Record<string, unknown>[];
}
/** Resolve the kinds filter to the (ticker, instrument) pairs it admits. */
async function resolve(input: FilterInput): Promise<Resolved> {
  const text = input.text?.trim() || undefined;
  const f: Resolved = { ...input, text };
  if (input.kinds?.length) {
    const kinds = new Set(input.kinds);
    const pairs = await rows(
      "SELECT DISTINCT ticker,instrument FROM claims",
      [],
    );
    f.kindPairs = pairs
      .map((r) => [str(r.ticker), str(r.instrument)] as const)
      .filter(([t, i]) => kinds.has(instrumentKind(t, i)))
      .map(([t, i]) => pairKey(t, i));
  }
  return f;
}
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => Number(v ?? 0);

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------
export type FacetValue = { value: string; count: number; label?: string | null };
export type CallRow = {
  id: string;
  runId: string;
  videoId: string;
  videoTitle: string | null;
  channelId: string | null;
  channelTitle: string | null;
  instrument: string | null;
  ticker: string | null;
  instrumentKey: string | null;
  kind: InstrumentKind;
  stance: string;
  sentiment: SentimentData;
  conviction: string;
  trustLevel: string;
  thesis: string;
  horizon: string | null;
  conditions: string[];
  risks: string[];
  publishedAt: string | null;
  createdAt: string | null;
  evidence: {
    ordinal: number;
    startSeconds: number | null;
    endSeconds: number | null;
    textOriginal: string;
    translationEn: string | null;
  }[];
};
type SentimentSplit = Record<SentimentData, { calls: number; creators: number }>;
export type InstrumentAggregate = {
  instrument: string;
  kind: InstrumentKind;
  calls: number;
  creators: number;
  bullish: number;
  neutral: number;
  bearish: number;
};
export type ChannelAggregate = {
  channelId: string;
  title: string | null;
  calls: number;
  bullish: number;
  neutral: number;
  bearish: number;
};
const SPLIT = (a: string) => `count(*) FILTER (WHERE ${sentimentSql(`${a}.stance`)}='bullish') AS bullish,
  count(*) FILTER (WHERE ${sentimentSql(`${a}.stance`)}='neutral') AS neutral,
  count(*) FILTER (WHERE ${sentimentSql(`${a}.stance`)}='bearish') AS bearish`;
const TOP = 10;
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}
async function channelTitles(ids: string[]) {
  if (!ids.length) return new Map<string, string | null>();
  const found = await rows("SELECT id,title FROM channels WHERE id = ANY($1::text[])", [ids]);
  return new Map(found.map((r) => [String(r.id), str(r.title)]));
}
/** Every known value of a closed facet is listed, zero counts included. */
function closed(values: readonly string[], counts: Map<string, number>): FacetValue[] {
  return values.map((value) => ({ value, count: counts.get(value) ?? 0 }));
}
/** An open facet lists what occurs, plus each selected value even at zero. */
function open(counts: Map<string, number>, selected: string[] = []): FacetValue[] {
  const result = [...counts].map(([value, count]) => ({ value, count }));
  for (const value of selected)
    if (!result.some((r) => r.value.toUpperCase() === value.toUpperCase()))
      result.push({ value, count: 0 });
  return result.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
async function facetCounts(f: Resolved, facet: Facet) {
  const p = params();
  const where = and(callConditions(f, p, "c", { skip: facet, titleSql: "r.title" }));
  const group: Record<Exclude<Facet, "kind">, string> = {
    instrument: KEY("c"),
    channel: "c.channel_id",
    stance: "c.stance",
    sentiment: sentimentSql("c.stance"),
    conviction: "c.creator_conviction",
    trust: "c.trust_level",
  };
  if (facet === "kind") {
    // A facet over the kind has to see the kind filter's own values, so the
    // pairs are grouped here and classified in one place.
    const found = await rows(
      withCanon(f, `SELECT c.ticker,c.instrument,count(*) AS n ${CALLS_FROM} WHERE ${where} GROUP BY 1,2`),
      p.values,
    );
    const counts = new Map<string, number>();
    for (const r of found) {
      const kind = instrumentKind(str(r.ticker), str(r.instrument));
      counts.set(kind, (counts.get(kind) ?? 0) + num(r.n));
    }
    return counts;
  }
  const found = await rows(
    withCanon(f, `SELECT ${group[facet]} AS value,count(*) AS n ${CALLS_FROM} WHERE ${where} GROUP BY 1`),
    p.values,
  );
  return new Map(
    found.filter((r) => r.value !== null).map((r) => [String(r.value), num(r.n)]),
  );
}
export async function queryCalls(input: unknown) {
  const q = CallsQuery.parse(input);
  const f = await resolve(q);
  const p = params();
  const where = and(callConditions(f, p, "c", { titleSql: "r.title" }));
  const order =
    q.sort === "conviction"
      ? `${CONVICTION_RANK} DESC, ${AT("c")} DESC, c.id`
      : q.sort === "trust"
        ? `c.trust_level DESC, ${AT("c")} DESC, c.id`
        : `${AT("c")} DESC, c.id`;
  const limit = p.add(q.limit),
    offset = p.add(q.offset);
  const page = await rows(
    withCanon(
      f,
      `SELECT c.*,r.title AS video_title,ch.title AS channel_title
       ${CALLS_FROM} LEFT JOIN channels ch ON ch.id=c.channel_id
       WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
    ),
    p.values,
  );
  const spans = page.length
    ? await rows(
        `SELECT claim_id,ordinal,start_seconds,end_seconds,text_original,translation_en
         FROM evidence_spans WHERE claim_id = ANY($1::text[]) ORDER BY claim_id,ordinal`,
        [page.map((r) => String(r.id))],
      )
    : [];
  const facetNames: Facet[] = ["instrument", "kind", "channel", "stance", "sentiment", "conviction", "trust"];
  const [aggregates, ...facetMaps] = await Promise.all([
    callAggregates(f),
    ...facetNames.map((facet) => facetCounts(f, facet)),
  ]);
  const facet = Object.fromEntries(facetNames.map((n, i) => [n, facetMaps[i]])) as Record<Facet, Map<string, number>>;
  const channelFacet = open(facet.channel, q.channels);
  const titles = await channelTitles(channelFacet.map((c) => c.value));
  const total = aggregates.calls;
  return {
    rows: page.map((r): CallRow => {
      const ticker = str(r.ticker),
        instrument = str(r.instrument);
      return {
        id: String(r.id),
        runId: String(r.run_id),
        videoId: String(r.video_id),
        videoTitle: str(r.video_title),
        channelId: str(r.channel_id),
        channelTitle: str(r.channel_title),
        instrument,
        ticker,
        instrumentKey: ticker ?? instrument,
        kind: instrumentKind(ticker, instrument),
        stance: String(r.stance),
        sentiment: (STANCE_SENTIMENT[r.stance as keyof typeof STANCE_SENTIMENT] ?? "neutral") as SentimentData,
        conviction: String(r.creator_conviction),
        trustLevel: String(r.trust_level),
        thesis: String(r.thesis_en),
        horizon: str(r.horizon_en),
        conditions: strings(r.conditions_en),
        risks: strings(r.risks_en),
        publishedAt: iso(r.published_at),
        createdAt: iso(r.created_at),
        evidence: spans
          .filter((s) => s.claim_id === r.id)
          .map((s) => ({
            ordinal: num(s.ordinal),
            startSeconds: s.start_seconds === null ? null : num(s.start_seconds),
            endSeconds: s.end_seconds === null ? null : num(s.end_seconds),
            textOriginal: String(s.text_original),
            translationEn: str(s.translation_en),
          })),
      };
    }),
    total,
    limit: q.limit,
    offset: q.offset,
    nextOffset: q.offset + page.length < total ? q.offset + page.length : null,
    sort: q.sort,
    facets: {
      instrument: open(facet.instrument, q.instruments),
      kind: closed(INSTRUMENT_KINDS, facet.kind),
      channel: channelFacet.map((c) => ({ ...c, label: titles.get(c.value) ?? null })),
      stance: closed(STANCES, facet.stance),
      sentiment: closed(SENTIMENTS, facet.sentiment),
      conviction: closed(CONVICTIONS, facet.conviction),
      trust: closed(TRUST_LEVELS, facet.trust),
    },
    aggregates,
  };
}
/** Set aggregates over the fully filtered calls. */
async function callAggregates(f: Resolved) {
  const p = params();
  const where = and(callConditions(f, p, "c", { titleSql: "r.title" }));
  const run = (sql: string) => rows(withCanon(f, sql), p.values);
  const [totals, bySentiment, byConviction, instruments, channels] = await Promise.all([
    run(`SELECT count(*) AS calls,count(DISTINCT c.video_id) AS videos,count(DISTINCT c.channel_id) AS creators ${CALLS_FROM} WHERE ${where}`),
    run(`SELECT ${sentimentSql("c.stance")} AS sentiment,count(*) AS calls,count(DISTINCT c.channel_id) AS creators ${CALLS_FROM} WHERE ${where} GROUP BY 1`),
    run(`SELECT c.creator_conviction AS conviction,count(*) AS calls ${CALLS_FROM} WHERE ${where} GROUP BY 1`),
    run(`SELECT ${KEY("c")} AS instrument,max(c.ticker) AS ticker,max(c.instrument) AS spoken,
        count(*) AS calls,count(DISTINCT c.channel_id) AS creators,${SPLIT("c")}
        ${CALLS_FROM} WHERE ${where} AND ${KEY("c")} IS NOT NULL
        GROUP BY 1 ORDER BY calls DESC,1 LIMIT ${TOP}`),
    run(`SELECT c.channel_id,max(ch.title) AS title,count(*) AS calls,${SPLIT("c")}
        ${CALLS_FROM} LEFT JOIN channels ch ON ch.id=c.channel_id
        WHERE ${where} AND c.channel_id IS NOT NULL
        GROUP BY 1 ORDER BY calls DESC,1 LIMIT ${TOP}`),
  ]);
  const sentiment = Object.fromEntries(
    SENTIMENTS.map((s) => {
      const r = bySentiment.find((row) => row.sentiment === s);
      return [s, { calls: num(r?.calls), creators: num(r?.creators) }];
    }),
  ) as SentimentSplit;
  const conviction = Object.fromEntries(
    CONVICTIONS.map((c) => [c, num(byConviction.find((r) => r.conviction === c)?.calls)]),
  ) as Record<(typeof CONVICTIONS)[number], number>;
  return {
    calls: num(totals[0]?.calls),
    videos: num(totals[0]?.videos),
    creators: num(totals[0]?.creators),
    sentiment,
    conviction,
    topInstruments: instruments.map(
      (r): InstrumentAggregate => ({
        instrument: String(r.instrument),
        kind: instrumentKind(str(r.ticker), str(r.spoken)),
        calls: num(r.calls),
        creators: num(r.creators),
        bullish: num(r.bullish),
        neutral: num(r.neutral),
        bearish: num(r.bearish),
      }),
    ),
    topChannels: channels.map(
      (r): ChannelAggregate => ({
        channelId: String(r.channel_id),
        title: str(r.title),
        calls: num(r.calls),
        bullish: num(r.bullish),
        neutral: num(r.neutral),
        bearish: num(r.bearish),
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------
/** A text that is an ISO date-time at its start becomes timestamptz; anything else is null, never an error. */
const TS = (text: string) =>
  `(CASE WHEN ${text} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (${text})::timestamptz END)`;
/**
 * Runs with the channel and publish time a list needs. Both are read from the
 * run's own calls first, then from the discovery row, and only then from the
 * run output, which COALESCE evaluates lazily — so a run with calls never has
 * its (large) output parsed.
 */
function videosCte(f: Resolved) {
  const canonical = f.canonicalOnly ? "AND r.id IN (SELECT id FROM canon)" : "";
  return `vids AS MATERIALIZED (
    SELECT r.id,r.video_id,r.title,r.status,r.created_at,
      COALESCE(
        (SELECT x.channel_id FROM claims x WHERE x.run_id=r.id AND x.channel_id IS NOT NULL LIMIT 1),
        (SELECT d.channel_id FROM yi_discoveries d WHERE d.video_id=r.video_id),
        (r.output::jsonb->'metadata'->>'channelId')) AS channel_id,
      COALESCE(
        (SELECT min(x.published_at) FROM claims x WHERE x.run_id=r.id),
        (SELECT ${TS("d.payload::jsonb->>'publishedAt'")} FROM yi_discoveries d WHERE d.video_id=r.video_id),
        ${TS("r.output::jsonb->'metadata'->>'publishedAt'")},
        ${TS("r.created_at")}) AS published_at
    FROM yi_runs r
    WHERE (r.input::jsonb->>'task') IS NULL
      ${canonical}
  )`;
}
export type VideoRow = {
  runId: string;
  videoId: string;
  title: string | null;
  channelId: string | null;
  channelTitle: string | null;
  publishedAt: string | null;
  createdAt: string | null;
  status: string;
  ideas: number;
  matchingCalls: number;
  sentiment: Record<SentimentData, number>;
  instruments: string[];
};
export async function queryVideos(input: unknown) {
  const q = VideosQuery.parse(input);
  const f = await resolve(q);
  const p = params();
  // Call-level filters, without text, channel or window (those are the run's).
  const callWhere = callConditions({ ...f, canonicalOnly: false }, p, "x", {
    callOnly: true,
    noText: true,
  });
  const active = callWhere.length > 0;
  const where: string[] = [];
  if (f.channels?.length) where.push(`v.channel_id = ANY(${p.add(f.channels)}::text[])`);
  if (f.from) where.push(`v.published_at >= ${p.add(lower(f.from))}::timestamptz`);
  if (f.to) where.push(`v.published_at < ${p.add(upper(f.to))}::timestamptz`);
  const some = (extra?: string) => {
    const conditions = extra === undefined ? callWhere : [...callWhere, extra];
    return `EXISTS (SELECT 1 FROM claims x WHERE x.run_id=v.id AND ${and(conditions)})`;
  };
  if (f.text) {
    const pattern = p.add(likePattern(f.text));
    const titleMatch = active ? `v.title ILIKE ${pattern} AND ${some()}` : `v.title ILIKE ${pattern}`;
    where.push(`((${titleMatch}) OR ${some(callText("x", pattern))})`);
  } else if (active) where.push(some());
  const matching = active
    ? `(SELECT count(*) FROM claims x WHERE x.run_id=v.id AND ${and(callWhere)})`
    : "(SELECT count(*) FROM claims x WHERE x.run_id=v.id)";
  const canon = f.canonicalOnly ? `canon AS MATERIALIZED (${CANONICAL}), ` : "";
  const cte = `WITH ${canon}${videosCte(f)}`;
  const filtered = `FROM vids v WHERE ${and(where)}`;
  const limit = p.add(q.limit),
    offset = p.add(q.offset);
  const byIdeas = q.sort === "ideas" ? "page.ideas DESC," : "";
  const [page, totals] = await Promise.all([
    rows(
      `${cte}, page AS (
        SELECT v.*, ${matching} AS matching,
          (SELECT count(*) FROM claims x WHERE x.run_id=v.id) AS ideas
        ${filtered}
      )
      SELECT page.*, ch.title AS channel_title FROM page
      LEFT JOIN channels ch ON ch.id=page.channel_id
      ORDER BY ${byIdeas} page.published_at DESC NULLS LAST, page.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
      p.values,
    ),
    rows(`${cte} SELECT count(*) AS n ${filtered}`, p.values.slice(0, -2)),
  ]);
  const ids = page.map((r) => String(r.id));
  const verdicts = ids.length
    ? await rows(
        `SELECT run_id,${KEY("x")} AS instrument,${sentimentSql("x.stance")} AS sentiment,count(*) AS n
         FROM claims x WHERE x.run_id = ANY($1::text[]) GROUP BY 1,2,3`,
        [ids],
      )
    : [];
  const total = num(totals[0]?.n);
  return {
    rows: page.map((r): VideoRow => {
      const mine = verdicts.filter((v) => v.run_id === r.id);
      const sentiment = { bullish: 0, neutral: 0, bearish: 0 };
      const byInstrument = new Map<string, number>();
      for (const v of mine) {
        sentiment[v.sentiment as SentimentData] += num(v.n);
        if (v.instrument !== null)
          byInstrument.set(String(v.instrument), (byInstrument.get(String(v.instrument)) ?? 0) + num(v.n));
      }
      return {
        runId: String(r.id),
        videoId: String(r.video_id),
        title: str(r.title),
        channelId: str(r.channel_id),
        channelTitle: str(r.channel_title),
        publishedAt: iso(r.published_at),
        createdAt: iso(r.created_at),
        status: String(r.status),
        ideas: num(r.ideas),
        matchingCalls: num(r.matching),
        sentiment,
        instruments: [...byInstrument]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([i]) => i),
      };
    }),
    total,
    limit: q.limit,
    offset: q.offset,
    nextOffset: q.offset + page.length < total ? q.offset + page.length : null,
    sort: q.sort,
  };
}

// ---------------------------------------------------------------------------
// Series (Trends, F65)
// ---------------------------------------------------------------------------
export type SeriesBucket = {
  start: string;
  label: string;
  calls: number;
  bullish: number;
  neutral: number;
  bearish: number;
};
export type SeriesPoint = {
  id: string;
  runId: string;
  date: string;
  instrument: string | null;
  stance: string;
  sentiment: SentimentData;
  conviction: string;
  trustLevel: string;
  thesis: string;
  channelId: string | null;
  channelTitle: string | null;
};
/** ISO 8601 week label for a Monday (UTC). */
function isoWeek(monday: string) {
  const d = new Date(`${monday}T00:00:00.000Z`);
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 4));
  const week =
    1 +
    Math.round(
      ((thursday.getTime() - first.getTime()) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7,
    );
  return `${year}-W${String(week).padStart(2, "0")}`;
}
const MAX_FILLED_BUCKETS = 1000;
function startOf(bound: string, bucket: "day" | "week") {
  const d = new Date(bound.length === 10 ? `${bound}T00:00:00.000Z` : bound);
  d.setUTCHours(0, 0, 0, 0);
  if (bucket === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}
/**
 * Calls per UTC day or ISO week (Monday start) with the three sentiments, plus
 * the individual calls as points. Empty periods between the window's ends (or
 * the first and last call) are filled with zero rows, up to 1,000 periods.
 * Points are the newest `pointCap` calls, returned oldest first; `truncated`
 * says when there were more.
 */
export async function querySeries(input: unknown) {
  const q = SeriesQuery.parse(input);
  const f = await resolve(q);
  const p = params();
  const where = and(callConditions(f, p, "c", { titleSql: "r.title" }));
  const unit = q.bucket === "week" ? "week" : "day";
  const bucketSql = `to_char(date_trunc('${unit}', ${AT("c")} AT TIME ZONE 'UTC'),'YYYY-MM-DD')`;
  const cap = p.add(q.pointCap);
  const [counts, points] = await Promise.all([
    rows(
      withCanon(f, `SELECT ${bucketSql} AS start,count(*) AS calls,${SPLIT("c")} ${CALLS_FROM} WHERE ${where} GROUP BY 1 ORDER BY 1`),
      p.values.slice(0, -1),
    ),
    rows(
      withCanon(
        f,
        `SELECT c.id,c.run_id,${KEY("c")} AS instrument,c.stance,c.creator_conviction,c.trust_level,c.thesis_en,c.channel_id,
          ch.title AS channel_title,to_char(${AT("c")} AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,${AT("c")} AS at
         ${CALLS_FROM} LEFT JOIN channels ch ON ch.id=c.channel_id
         WHERE ${where} ORDER BY ${AT("c")} DESC,c.id DESC LIMIT ${cap}`,
      ),
      p.values,
    ),
  ]);
  const observed = new Map(
    counts.map((r) => [
      String(r.start),
      { calls: num(r.calls), bullish: num(r.bullish), neutral: num(r.neutral), bearish: num(r.bearish) },
    ]),
  );
  const keys = [...observed.keys()];
  const first = q.from ?? keys[0],
    last = q.to ?? keys.at(-1);
  const filled: string[] = [];
  if (first && last) {
    const step = q.bucket === "week" ? 7 : 1;
    const end = startOf(last, q.bucket);
    for (
      const d = startOf(first, q.bucket);
      d <= end && filled.length <= MAX_FILLED_BUCKETS;
      d.setUTCDate(d.getUTCDate() + step)
    )
      filled.push(d.toISOString().slice(0, 10));
  }
  const starts =
    filled.length <= MAX_FILLED_BUCKETS
      ? [...new Set([...filled, ...keys])].sort()
      : keys;
  const total = [...observed.values()].reduce((n, b) => n + b.calls, 0);
  return {
    bucket: q.bucket,
    buckets: starts.map(
      (start): SeriesBucket => ({
        start,
        label: q.bucket === "week" ? isoWeek(start) : start,
        ...(observed.get(start) ?? { calls: 0, bullish: 0, neutral: 0, bearish: 0 }),
      }),
    ),
    filled: filled.length <= MAX_FILLED_BUCKETS,
    total,
    points: points
      .map(
        (r): SeriesPoint => ({
          id: String(r.id),
          runId: String(r.run_id),
          date: String(r.day),
          instrument: str(r.instrument),
          stance: String(r.stance),
          sentiment: (STANCE_SENTIMENT[r.stance as keyof typeof STANCE_SENTIMENT] ?? "neutral") as SentimentData,
          conviction: String(r.creator_conviction),
          trustLevel: String(r.trust_level),
          thesis: String(r.thesis_en),
          channelId: str(r.channel_id),
          channelTitle: str(r.channel_title),
        }),
      )
      .reverse(),
    truncated: total > points.length,
  };
}

// ---------------------------------------------------------------------------
// Quick-search index (F76)
// ---------------------------------------------------------------------------
/**
 * What quick search matches against on the client: instruments with their call
 * counts, every channel (followed or seen in a call), and the newest canonical
 * videos. The lists are bounded by the input and `totals` gives the true sizes.
 */
export async function querySearchIndex(input: unknown) {
  const q = SearchIndexQuery.parse(input);
  const f: Resolved = { pinnedOnly: false, canonicalOnly: true };
  const canon = `WITH canon AS MATERIALIZED (${CANONICAL})`;
  const [instruments, instrumentTotal, calls, channels, videos, videoTotal] = await Promise.all([
    rows(
      `${canon} SELECT ${KEY("c")} AS instrument,max(c.ticker) AS ticker,max(c.instrument) AS spoken,count(*) AS calls
       FROM claims c WHERE c.run_id IN (SELECT id FROM canon) AND ${KEY("c")} IS NOT NULL
       GROUP BY 1 ORDER BY calls DESC,1 LIMIT $1`,
      [q.instruments],
    ),
    rows(
      `${canon} SELECT count(DISTINCT ${KEY("c")}) AS n FROM claims c WHERE c.run_id IN (SELECT id FROM canon)`,
      [],
    ),
    rows(
      `${canon} SELECT c.channel_id,count(*) AS calls,count(DISTINCT c.video_id) AS videos
       FROM claims c WHERE c.run_id IN (SELECT id FROM canon) AND c.channel_id IS NOT NULL GROUP BY 1`,
      [],
    ),
    rows("SELECT id,title,handle FROM channels", []),
    rows(
      `WITH canon AS MATERIALIZED (${CANONICAL}), ${videosCte(f)}
       SELECT id,video_id,title,channel_id,published_at FROM vids
       ORDER BY published_at DESC NULLS LAST,id DESC LIMIT $1`,
      [q.videos],
    ),
    rows(`${canon} SELECT count(*) AS n FROM canon`, []),
  ]);
  const byChannel = new Map(calls.map((r) => [String(r.channel_id), r]));
  const known = new Map(channels.map((r) => [String(r.id), r]));
  const channelIds = [...new Set([...known.keys(), ...byChannel.keys()])];
  return {
    instruments: instruments.map((r) => ({
      instrument: String(r.instrument),
      kind: instrumentKind(str(r.ticker), str(r.spoken)),
      calls: num(r.calls),
    })),
    channels: channelIds
      .map((id) => ({
        channelId: id,
        title: str(known.get(id)?.title),
        handle: str(known.get(id)?.handle),
        calls: num(byChannel.get(id)?.calls),
        videos: num(byChannel.get(id)?.videos),
      }))
      .sort((a, b) => b.calls - a.calls || (a.title ?? a.channelId).localeCompare(b.title ?? b.channelId)),
    videos: videos.map((r) => ({
      runId: String(r.id),
      videoId: String(r.video_id),
      title: str(r.title),
      channelId: str(r.channel_id),
      publishedAt: iso(r.published_at),
    })),
    totals: {
      instruments: num(instrumentTotal[0]?.n),
      channels: channelIds.length,
      videos: num(videoTotal[0]?.n),
    },
  };
}
