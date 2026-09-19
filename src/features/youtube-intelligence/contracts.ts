import { z } from "zod";
import { createHash } from "node:crypto";
import { levelQualifierIssues } from "./level-qualifiers.ts";
import { alignCaptionEvidence } from "./evidence-alignment.ts";
export const MODELS = [
  "google/gemini-3.8-flash",
  "google/gemini-3.5-flash",
  "google/gemini-3.1-pro-preview",
] as const;
export const Segment = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  start_seconds: z.number().nonnegative().nullable(),
  end_seconds: z.number().nonnegative().nullable(),
});
export const Source = z
  .object({
    video_id: z.string().optional(),
    language: z.string().optional(),
    source_kind: z.string().default("imported_transcript"),
    // Explicit caption boundary formatting; original segment text is never rewritten.
    segment_separator: z.enum(["", " "]).optional(),
    segments: z.array(Segment).min(1).max(20000),
  })
  .superRefine((s, c) => {
    const ids = new Set();
    for (const x of s.segments) {
      if (
        ids.has(x.id) ||
        (x.start_seconds !== null &&
          x.end_seconds !== null &&
          x.end_seconds < x.start_seconds)
      )
        c.addIssue({
          code: "custom",
          message: "Duplicate segment ID or reversed timestamp",
        });
      ids.add(x.id);
    }
  });
/**
 * A copied source range. start_id/end_id are retained segment IDs; the seconds
 * are the bounds those segments carry (null when the source has no times) and
 * text_hash is sha256 of the copied text, so a later source edit is detectable.
 */
export const SourceSpan = z.object({
  start_id: z.string().min(1),
  end_id: z.string().min(1),
  start_seconds: z.number().nonnegative().nullable(),
  end_seconds: z.number().nonnegative().nullable(),
  text_hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SourceSpanData = z.infer<typeof SourceSpan>;
/** Bounds on a copied range: segments, seconds and characters. */
export const SPAN_LIMITS = {
  segments: 100,
  seconds: 120,
  characters: 4000,
} as const;
const englishOutput = z
  .string()
  .refine(
    (s) => !/\p{Script=Han}/u.test(s),
    "Research display and translations must be English; preserve original language only in source fields.",
  );
export const Claim = z.object({
  thesis_en: englishOutput.refine((s) => s.trim().length > 0),
  instrument_as_spoken: z.string().nullable(),
  ticker: z.string().nullable(),
  ticker_explicit: z.boolean(),
  stance: z.enum([
    "long",
    "short",
    "neutral",
    "avoid",
    "watch",
    "hold",
    "conditional",
  ]),
  horizon_en: englishOutput.nullable(),
  conditions_en: z.array(englishOutput),
  creator_conviction: z.enum(["high", "medium", "low", "unspecified"]),
  risks_en: z.array(englishOutput),
  levels: z.array(
    z.object({
      kind: z.enum([
        "entry",
        "target",
        "stop",
        "support",
        "resistance",
        "strike",
      ]),
      value_original: z.string(),
    }),
  ),
  evidence: z
    .array(
      z.object({
        segment_id: z.string(),
        end_segment_id: z.string().optional(),
        quote_original: z.string().min(1),
        quote_translation_en: englishOutput,
        /**
         * Pointer evidence (spec 4.2): the model named a segment range and the
         * application copied the text, so quote_original is derived from these
         * IDs rather than written by the model. Absent on legacy quote claims.
         */
        source_span: SourceSpan.optional(),
      }),
    )
    .min(1),
});
export type SourceData = z.infer<typeof Source>;
export type ClaimData = z.infer<typeof Claim>;
export type StanceData = ClaimData["stance"];
/** Where a mentioned instrument trades. Resolution beyond what the creator said is the market map in the leaderboard work; the model answers "unknown" when it cannot tell. */
export const MARKETS = [
  "us-stock",
  "us-etf",
  "hk",
  "cn-a",
  "other",
  "unknown",
] as const;
/** Every stance-tagged reference grades to one of three sentiments (spec 4.13). */
export const SENTIMENTS = ["bullish", "neutral", "bearish"] as const;
/**
 * One stance-tagged reference to an instrument, whether or not it is an
 * actionable call (spec 4.13). Two fields make an aggregate traceable and are
 * therefore required: `source_span`, the same pointer a claim's evidence
 * carries, so a sentiment count always opens onto the cited moment — a mention
 * whose span does not resolve is rejected, never stored — and `rationale_en`,
 * the one sentence that says why this reference reads bullish, neutral or
 * bearish. `is_call` marks the stricter subset that is also a claim, and
 * `claim_id` links to it; for those the sentiment is the deterministic value
 * from the stance table, not the model's own reading.
 */
export const Mention = z.object({
  ticker: z.string().nullable(),
  instrument_as_spoken: z.string().min(1),
  market: z.enum(MARKETS),
  stance: Claim.shape.stance,
  sentiment: z.enum(SENTIMENTS),
  rationale_en: englishOutput
    .min(1)
    .refine(
      (s) => s.trim().length > 0,
      "A mention needs a one-sentence rationale for its sentiment.",
    ),
  source_span: SourceSpan,
  is_call: z.boolean(),
  claim_id: z.string().nullable(),
});
export type MentionData = z.infer<typeof Mention>;
export type SentimentData = MentionData["sentiment"];
export type CheckedClaim = {
  id: string;
  claim: ClaimData;
  passed: boolean;
  reasons: string[];
  audit?: { verdict: string; reason_en: string };
};
export type Run = {
  id: string;
  videoId: string;
  url: string;
  model: string;
  promptVersion: string;
  title: string;
  status: string;
  stage: string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  cost: number;
};
export function videoId(raw: string) {
  const u = new URL(raw);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw Error("Use a public YouTube video URL.");
  const h = u.hostname.toLowerCase();
  let id = "";
  if (h === "youtu.be") id = u.pathname.slice(1);
  else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(h))
    id =
      u.pathname === "/watch"
        ? u.searchParams.get("v") || ""
        : /^\/(shorts|live|embed)\/([^/]+)$/.exec(u.pathname)?.[2] || "";
  if (!/^[\w-]{11}$/.test(id)) throw Error("Use a valid YouTube video URL.");
  return id;
}
/**
 * Copy one source range (spec 4.2: evidence by pointer). The model supplies
 * start_id and end_id only; the application copies the retained segment texts
 * for that inclusive range, joins them exactly as the caption join does, and
 * derives the quote, its seconds and its hash. quote_original is therefore
 * never model-written. Unknown, reversed, over-long and over-slow ranges throw:
 * a bad pointer is a rejected extraction, not a silently truncated quote.
 */
export function deriveEvidence(
  source: SourceData,
  span: { start_id: string; end_id: string },
) {
  const start = source.segments.findIndex((s) => s.id === span.start_id),
    end = source.segments.findIndex((s) => s.id === span.end_id);
  if (
    start < 0 ||
    end < 0 ||
    end < start ||
    end - start >= SPAN_LIMITS.segments
  )
    throw Error("Unknown, reversed or excessive source range");
  const first = source.segments[start],
    last = source.segments[end];
  if (
    first.start_seconds !== null &&
    last.end_seconds !== null &&
    last.end_seconds - first.start_seconds > SPAN_LIMITS.seconds
  )
    throw Error("Evidence range exceeds two minutes");
  const quote_original = source.segments
    .slice(start, end + 1)
    .map((s) => s.text)
    .join(source.segment_separator || "");
  if (quote_original.length > SPAN_LIMITS.characters)
    throw Error("Evidence range exceeds text limit");
  return {
    quote_original,
    start_seconds: first.start_seconds,
    end_seconds: last.end_seconds,
    text_hash: createHash("sha256").update(quote_original).digest("hex"),
  };
}
/**
 * Structural checks on one claim. With pointer evidence (source_span present)
 * the application copied the text itself, so the quote-versus-source string
 * match is an assertion: a mismatch means the retained source changed under a
 * stored claim, and it is recorded in `warnings` rather than rejecting the
 * claim. Legacy quote evidence keeps rejecting, unchanged.
 */
export function validateClaim(
  claim: ClaimData,
  source: SourceData,
  warnings?: string[],
) {
  const reasons: string[] = [];
  const quotes: string[] = [];
  for (const e of claim.evidence) {
    if (e.source_span) {
      let derived: ReturnType<typeof deriveEvidence> | null = null;
      try {
        derived = deriveEvidence(source, e.source_span);
      } catch {
        derived = null;
      }
      if (
        !derived ||
        derived.quote_original !== e.quote_original ||
        derived.text_hash !== e.source_span.text_hash
      )
        warnings?.push(
          `Pointer evidence ${e.source_span.start_id}..${e.source_span.end_id} no longer matches the retained source text.`,
        );
      quotes.push(e.quote_original);
      continue;
    }
    const start = source.segments.findIndex((s) => s.id === e.segment_id),
      end = e.end_segment_id
        ? source.segments.findIndex((s) => s.id === e.end_segment_id)
        : start;
    const text =
      start >= 0 && end >= start && end - start < 100
        ? source.segments
            .slice(start, end + 1)
            .map((s) => s.text)
            .join(source.segment_separator || "")
        : "";
    const offset = text.indexOf(e.quote_original);
    if (offset < 0 || offset >= (source.segments[start]?.text.length || 0))
      reasons.push("Quote does not match the retained source.");
    quotes.push(e.quote_original);
  }
  for (const l of claim.levels)
    if (
      !quotes.some((q) =>
        new RegExp(
          `(?<![0-9])(?<![0-9][.,])${l.value_original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9]|[.,][0-9])`,
        ).test(q),
      )
    )
      reasons.push("Price is not present verbatim in its evidence.");
  if (
    claim.ticker &&
    (!claim.ticker_explicit ||
      !quotes.some((q) =>
        new RegExp(
          `(^|[^A-Za-z0-9])${claim.ticker!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`,
          "i",
        ).test(q),
      ))
  )
    reasons.push("Ticker is not explicit in its evidence.");
  return [...reasons, ...levelQualifierIssues(claim)];
}
export function coverage(source: SourceData, duration: number) {
  const spans = source.segments
    .filter((s) => s.start_seconds !== null && s.end_seconds !== null)
    .map((s) => [s.start_seconds!, Math.min(duration, s.end_seconds!)])
    .sort((a, b) => a[0] - b[0]);
  let covered = 0,
    end = 0;
  for (const [a, b] of spans) {
    if (b > a) {
      covered += Math.max(0, b - Math.max(a, end));
      end = Math.max(end, b);
    }
  }
  const ratio = duration > 0 ? covered / duration : 0;
  return {
    ratio,
    coveredSeconds: covered,
    durationSeconds: duration,
    status:
      ratio >= 0.9 ? "timestamps_cover_most_video" : "incomplete_or_unknown",
    audioVerified: false,
  };
}

export function anchorClaimEvidence(
  claim: ClaimData,
  source: SourceData,
): ClaimData {
  return {
    ...claim,
    evidence: claim.evidence.map((e) => {
      const aligned = alignCaptionEvidence(e, source);
      if (aligned !== e) return aligned;
      if (e.end_segment_id) return e;
      const start = source.segments.findIndex((s) => s.id === e.segment_id);
      if (start < 0 || source.segments[start].text.includes(e.quote_original))
        return e;
      let text = source.segments[start].text;
      for (
        let end = start + 1;
        end < Math.min(source.segments.length, start + 12);
        end++
      ) {
        text += (source.segment_separator || "") + source.segments[end].text;
        const offset = text.indexOf(e.quote_original);
        if (offset >= 0 && offset < source.segments[start].text.length)
          return { ...e, end_segment_id: source.segments[end].id };
      }
      return e;
    }),
  };
}
