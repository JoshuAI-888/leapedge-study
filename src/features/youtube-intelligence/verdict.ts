/**
 * The verdict, summary and key points of one analysis (F61), as pure
 * functions over stored rows. Nothing here calls a model: every line is
 * derived from what extraction, the critic and (when present) a research
 * brief already stored.
 *
 * - Verdict: the accepted (published) calls of the run: how many, the three
 *   sentiments their stances grade to, the instruments, and one overall
 *   creator conviction.
 * - Summary: the newest research brief's lead sentence. Extraction has no
 *   summary field today; a string `summary` on the run output is used if a
 *   later extraction adds one. Otherwise there is no summary line: the page
 *   says one appears once a brief is generated, and nothing is invented.
 * - Key points: passed, unflagged research-context points plus the accepted
 *   calls, in video order by their earliest evidence time, at most ten.
 */
import type { CheckedClaim, SentimentData } from "./contracts.ts";
import {
  describeInstrument,
  type ClaimLike,
  type InstrumentDescription,
} from "./instrument-kind.ts";
import {
  SENTIMENTS,
  SENTIMENT_GLYPH,
  sentimentCounts,
  type SentimentSplit,
} from "./ui/foundations.ts";

export const NO_IDEAS_TEXT = "No investable ideas · educational or commentary";
export const MAX_KEY_POINTS = 10;

export type VerdictClaim = ClaimLike & {
  stance: string;
  creatorConviction: string;
};
export type Conviction = "high" | "medium" | "low" | "unspecified";
const RANK: Record<Conviction, number> = {
  high: 3,
  medium: 2,
  low: 1,
  unspecified: 0,
};
const conviction = (value: string): Conviction =>
  value in RANK ? (value as Conviction) : "unspecified";

/**
 * One conviction for the whole video. The rule: the most common conviction
 * the creator stated across accepted calls; a tie goes to the higher one.
 * "Unspecified" only wins when no call states a conviction, and null means
 * there are no calls at all.
 */
export function overallConviction(
  claims: { creatorConviction: string }[],
): Conviction | null {
  if (!claims.length) return null;
  const counts = new Map<Conviction, number>();
  for (const c of claims) {
    const value = conviction(c.creatorConviction);
    if (value !== "unspecified") counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  if (!counts.size) return "unspecified";
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || RANK[b[0]] - RANK[a[0]],
  )[0][0];
}

export type Verdict = {
  ideas: number;
  split: SentimentSplit;
  conviction: Conviction | null;
  /** Distinct instruments by label text, in the order calls name them. */
  instruments: (InstrumentDescription & { claim: VerdictClaim })[];
};

/** The verdict of a set of accepted calls. */
export function verdictOf(claims: VerdictClaim[]): Verdict {
  const seen = new Set<string>();
  const instruments: Verdict["instruments"] = [];
  for (const claim of claims) {
    const d = describeInstrument(claim);
    if (seen.has(d.text)) continue;
    seen.add(d.text);
    instruments.push({ ...d, claim });
  }
  return {
    ideas: claims.length,
    split: sentimentCounts(claims),
    conviction: overallConviction(claims),
    instruments,
  };
}

/** "3 ▲ 1 ●": counts with their glyph, zero sentiments left out. */
export function splitShortText(split: Record<SentimentData, number>) {
  return SENTIMENTS.filter((s) => split[s] > 0)
    .map((s) => `${split[s]} ${SENTIMENT_GLYPH[s]}`)
    .join(" ");
}

/** "4 ideas · 3 ▲ 1 ● · NVDA AVGO TSM", or the no-ideas sentence. */
export function verdictLineText(v: Verdict) {
  if (!v.ideas) return NO_IDEAS_TEXT;
  return [
    `${v.ideas} ${v.ideas === 1 ? "idea" : "ideas"}`,
    splitShortText(v.split),
    v.instruments.map((i) => i.text).join(" "),
  ]
    .filter(Boolean)
    .join(" · ");
}

export const convictionText = (c: Conviction | null) =>
  c === null
    ? ""
    : c === "unspecified"
      ? "Conviction not stated"
      : `${c[0].toUpperCase()}${c.slice(1)} conviction`;

export type KeyPointItem = {
  id: string;
  text: string;
  /** Earliest cited second, or null when the evidence is untimed. */
  seconds: number | null;
  kind: "context" | "call";
};

const normal = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * At most ten points in video order. Untimed points go last in their stored
 * order; a repeated sentence keeps its earliest moment.
 */
export function keyPointsOf(
  items: KeyPointItem[],
  max = MAX_KEY_POINTS,
): KeyPointItem[] {
  const ordered = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.text.trim())
    .sort((a, b) => {
      const x = a.item.seconds,
        y = b.item.seconds;
      if (x !== null && y !== null && x !== y) return x - y;
      if (x === null && y !== null) return 1;
      if (y === null && x !== null) return -1;
      return a.index - b.index;
    });
  const seen = new Set<string>();
  const points: KeyPointItem[] = [];
  for (const { item } of ordered) {
    const key = normal(item.text);
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ ...item, text: item.text.trim() });
    if (points.length >= max) break;
  }
  return points;
}

const earliest = (values: (number | null | undefined)[]) => {
  const timed = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  return timed.length ? Math.min(...timed) : null;
};
const accepted = (c: CheckedClaim) => c.passed && !(c.reasons?.length ?? 0);

/**
 * The candidates for key points: research-context points that passed their
 * checks with no reasons against them, and the calls that were published
 * (their stored rows are the accepted set). A call's time comes from its
 * persisted evidence spans when there are any, else from the checked claim.
 */
export function keyPointItems(input: {
  runId: string;
  keyPoints: unknown;
  checkedClaims: unknown;
  acceptedClaimIds: string[];
  spans: { claimId: string; startSeconds: number | null }[];
}): KeyPointItem[] {
  const list = (v: unknown) => (Array.isArray(v) ? (v as CheckedClaim[]) : []);
  const context = list(input.keyPoints)
    .filter(accepted)
    .map((point) => ({
      id: point.id,
      text: point.claim?.thesis_en ?? "",
      seconds: earliest(
        (point.claim?.evidence ?? []).map((e) => e.source_span?.start_seconds),
      ),
      kind: "context" as const,
    }));
  const published = new Set(input.acceptedClaimIds);
  const calls = list(input.checkedClaims)
    .filter((c) => published.has(`${input.runId}:${c.id}`))
    .map((c) => {
      const stored = input.spans
        .filter((s) => s.claimId === `${input.runId}:${c.id}`)
        .map((s) => s.startSeconds);
      return {
        id: `${input.runId}:${c.id}`,
        text: c.claim?.thesis_en ?? "",
        seconds: earliest(stored) ?? earliest(
          (c.claim?.evidence ?? []).map((e) => e.source_span?.start_seconds),
        ),
        kind: "call" as const,
      };
    });
  return [...context, ...calls];
}

/** The summary line, or null when nothing stored can supply one. */
export function summaryOf(input: {
  briefs: { createdAt: string; sentences: { text: string }[] }[];
  extractionSummary: unknown;
}): { text: string; source: "brief" | "extraction" } | null {
  const newest = [...input.briefs].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];
  const lead = newest?.sentences.find((s) => s.text.trim())?.text.trim();
  if (lead) return { text: lead, source: "brief" };
  if (
    typeof input.extractionSummary === "string" &&
    input.extractionSummary.trim()
  )
    return { text: input.extractionSummary.trim(), source: "extraction" };
  return null;
}

/** "Chinese → English", "English", or null for an unknown or unreadable tag. */
export function sourceLanguageLabel(tag: unknown): string | null {
  if (typeof tag !== "string") return null;
  const code = tag.replace(/^asr-/i, "").trim();
  if (!/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(code)) return null;
  let name: string | undefined;
  try {
    name = new Intl.DisplayNames(["en"], { type: "language" }).of(
      code.split(/[-_]/)[0].toLowerCase(),
    );
  } catch {
    return null;
  }
  if (!name || name.toLowerCase() === code.toLowerCase()) return null;
  return /^english$/i.test(name) ? "English" : `${name} → English`;
}

/**
 * What a research brief has cost on average: model plus external search, over
 * briefs that recorded both. Null when none did, so the page states no number
 * rather than a guess.
 */
export function briefCostEstimate(
  briefs: { modelCostUsd?: unknown; externalCostUsd?: unknown }[],
): { averageUsd: number; samples: number } | null {
  const costs = briefs.flatMap((b) =>
    typeof b.modelCostUsd === "number" &&
    Number.isFinite(b.modelCostUsd) &&
    typeof b.externalCostUsd === "number" &&
    Number.isFinite(b.externalCostUsd)
      ? [b.modelCostUsd + b.externalCostUsd]
      : [],
  );
  return costs.length
    ? {
        averageUsd: costs.reduce((a, b) => a + b, 0) / costs.length,
        samples: costs.length,
      }
    : null;
}

/** "m:ss" or "h:mm:ss" for a player position. */
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** Plain words for a stored transcript source kind; never the raw key. */
export function sourceKindText(kind: unknown): string {
  const k = typeof kind === "string" ? kind.toLowerCase() : "";
  if (!k) return "See evidence details";
  if (k.includes("fixture")) return "Fixture transcript";
  if (/asr|model_generated|audio/.test(k)) return "Audio transcription";
  if (k.includes("caption")) return "YouTube captions";
  if (k.includes("import")) return "Imported transcript";
  return "Transcript";
}
