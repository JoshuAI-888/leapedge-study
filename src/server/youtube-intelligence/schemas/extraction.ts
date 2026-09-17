import { z } from "zod";
import {
  RangeSelectedClaim,
  type RangeSelectedClaimData,
} from "../../../features/youtube-intelligence/evidence-selection.ts";
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
            enum: ["entry", "target", "stop", "support", "resistance"],
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
      items: {
        type: "object",
        properties: {
          start_id: { type: "string", minLength: 1 },
          end_id: { type: "string", minLength: 1 },
        },
        required: ["start_id", "end_id"],
      },
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
export const extractionResponseSchema = {
  type: "object",
  properties: {
    claims: { type: "array", maxItems: 40, items: claimSchema },
    key_points: { type: "array", maxItems: 30, items: claimSchema },
  },
  required: ["claims", "key_points"],
};
/** The same contract on the way back in: ranges, never quotes. */
export const PointerExtraction = z.object({
  claims: z.array(RangeSelectedClaim).max(40),
  key_points: z.array(RangeSelectedClaim).max(30).default([]),
});
export type PointerExtractionData = z.infer<typeof PointerExtraction>;
export type { RangeSelectedClaimData };
export function parsePointerExtraction(raw: unknown): PointerExtractionData {
  return PointerExtraction.parse(raw);
}
/** The instruction that accompanies the schema; the payload shape is unchanged. */
export const POINTER_EVIDENCE_FORMAT =
  "Evidence is pointers only. For each claim return evidence_ranges: one or more {start_id, end_id} pairs naming the FIRST and LAST real segment ID of a contiguous supporting span; start_id and end_id may be the same segment. Never write a quote: the application copies the exact source text for the range you name, so a paraphrase cannot enter the record. Keep each range within 100 segments and two minutes. Preserve all numerical comparators and conditions in the English fields. value_original must include the exact comparator where spoken (for example under $20), not just the number, and it must appear verbatim inside one of the ranges you cite.";
