import { z } from "zod";
import {
  RangeSelectedClaim,
  type RangeSelectedClaimData,
} from "../../../features/youtube-intelligence/evidence-selection.ts";
import {
  MARKETS,
  Mention,
  SENTIMENTS,
} from "../../../features/youtube-intelligence/contracts.ts";
/**
 * The extraction output contract as a provider response schema (spec 4.2).
 *
 * Evidence is pointers only: each claim lists {start_id, end_id} ranges over
 * the retained source segments, and the application copies the text
 * (deriveEvidence / materializeEvidenceRanges). No quote field exists here, so
 * the model cannot write a quote at all — the "more than 20 IDs" and
 * paraphrased-quote failures are removed by construction rather than caught
 * afterwards.
 *
 * The value is plain JSON so it can be handed to ModelRequest.responseSchema
 * unchanged; the zod parser below is the same contract on the way back in,
 * because a schema a transport may or may not enforce is not a validation.
 */
/** Gemini's schema subset spells an optional string this way; other transports ignore the keyword. */
const stringOrNull = { type: "string", nullable: true };
const rangeItemSchema = {
  type: "object",
  properties: {
    start_id: { type: "string", minLength: 1 },
    end_id: { type: "string", minLength: 1 },
  },
  required: ["start_id", "end_id"],
};
const claimSchema = {
  type: "object",
  properties: {
    thesis_en: { type: "string", minLength: 1 },
    instrument_as_spoken: stringOrNull,
    ticker: stringOrNull,
    ticker_explicit: { type: "boolean" },
    stance: {
      type: "string",
      enum: [
        "long",
        "short",
        "neutral",
        "avoid",
        "watch",
        "hold",
        "conditional",
      ],
    },
    horizon_en: stringOrNull,
    conditions_en: { type: "array", items: { type: "string" } },
    creator_conviction: {
      type: "string",
      enum: ["high", "medium", "low", "unspecified"],
    },
    risks_en: { type: "array", items: { type: "string" } },
    levels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "entry",
              "target",
              "stop",
              "support",
              "resistance",
              "strike",
            ],
          },
          value_original: { type: "string" },
        },
        required: ["kind", "value_original"],
      },
    },
    evidence_ranges: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: rangeItemSchema,
    },
  },
  required: [
    "thesis_en",
    "instrument_as_spoken",
    "ticker",
    "ticker_explicit",
    "stance",
    "horizon_en",
    "conditions_en",
    "creator_conviction",
    "risks_en",
    "levels",
    "evidence_ranges",
  ],
};
/**
 * A mention as extraction returns it (spec 4.13): pointers rather than text,
 * like a claim, and no `is_call` or `claim_id` — whether a mention is also an
 * actionable call is decided by the application from the claims in the same
 * extraction, so the model cannot promote its own reference to a call.
 */
const mentionSchema = {
  type: "object",
  properties: {
    ticker: stringOrNull,
    instrument_as_spoken: { type: "string", minLength: 1 },
    market: { type: "string", enum: [...MARKETS] },
    stance: { type: "string", enum: [...Mention.shape.stance.options] },
    sentiment: { type: "string", enum: [...SENTIMENTS] },
    rationale_en: { type: "string", minLength: 1 },
    ranges: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: rangeItemSchema,
    },
  },
  required: [
    "ticker",
    "instrument_as_spoken",
    "market",
    "stance",
    "sentiment",
    "rationale_en",
    "ranges",
  ],
};
export const extractionResponseSchema = {
  type: "object",
  properties: {
    claims: { type: "array", maxItems: 40, items: claimSchema },
    key_points: { type: "array", maxItems: 30, items: claimSchema },
    mentions: { type: "array", maxItems: 200, items: mentionSchema },
  },
  required: ["claims", "key_points", "mentions"],
};
/**
 * The same mention contract on the way back in. `ranges` carries no minimum
 * here on purpose: a mention that cites nothing is rejected one mention at a
 * time and recorded with its reason, because one unusable pointer must not
 * discard an extraction's claims.
 */
export const MentionExtraction = Mention.omit({
  source_span: true,
  is_call: true,
  claim_id: true,
}).extend({
  ranges: z
    .array(z.object({ start_id: z.string().min(1), end_id: z.string().min(1) }))
    .max(20),
});
export type MentionExtractionData = z.infer<typeof MentionExtraction>;
/** The same contract on the way back in: ranges, never quotes. */
export const PointerExtraction = z.object({
  claims: z.array(RangeSelectedClaim).max(40),
  key_points: z.array(RangeSelectedClaim).max(30).default([]),
  mentions: z.array(MentionExtraction).max(200).default([]),
});
export type PointerExtractionData = z.infer<typeof PointerExtraction>;
export type { RangeSelectedClaimData };
export function parsePointerExtraction(raw: unknown): PointerExtractionData {
  return PointerExtraction.parse(raw);
}
/** The instruction that accompanies the schema; the payload shape is unchanged. */
export const POINTER_EVIDENCE_FORMAT =
  "Evidence is pointers only. For each claim return evidence_ranges: one or more {start_id, end_id} pairs naming the FIRST and LAST real segment ID of a contiguous supporting span; start_id and end_id may be the same segment. Never write a quote: the application copies the exact source text for the range you name, so a paraphrase cannot enter the record. Keep each range within 100 segments and two minutes. Preserve all numerical comparators and conditions in the English fields. value_original must include the exact comparator where spoken (for example under $20), not just the number, and it must appear verbatim inside one of the ranges you cite.";
/** Said alongside the pointer instruction; the sentiment rules the prompt version elaborates. */
export const MENTION_OUTPUT_FORMAT =
  "Also return mentions: every stance-tagged reference to an instrument, including the ones that are already claims, each with {ticker, instrument_as_spoken, market, stance, sentiment, rationale_en, ranges}. rationale_en is one English sentence that quotes or paraphrases the span you cite. Cite the span the same way, with ranges of segment IDs; a mention without a range is discarded. market is unknown unless the creator made it clear. For a reference that is also an actionable call the application overrides your sentiment with the value its stance table gives, so grade the stance honestly rather than the outcome you expect.";

/** Semantics applied independently of the historical prompt snapshot. */
export const FINANCIAL_SEMANTICS =
  "Keep actionable creator instructions in claims; put hypothetical returns, educational scenarios and descriptive commentary in key_points unless the creator expresses an actual position or action. A conditional action must retain every trigger. Extract separate claims for separately named companies ONLY when the same cited instruction truly applies to each; never substitute tickers or ETFs for a sector, theme, index or vague group. Preserve options mechanics explicitly: put/call, buy/sell, strike as levels.kind=strike (not entry), expiry exactly as spoken in horizon_en, and the underlying support separately. Do not infer an expiry year. Preserve percentage upside/downside targets as target levels with their exact original strings. Do not omit conditions, expiry or price-role labels to shorten output. Use multiple short supporting ranges when needed. A company name can remain unresolved: ticker is only the literal ticker in the source, not a guess from the name.";
