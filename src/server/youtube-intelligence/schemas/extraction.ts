import { z } from "zod";
import {
  RangeSelectedClaim,
  type RangeSelectedClaimData,
} from "../../../features/youtube-intelligence/evidence-selection.ts";
import {
  ACTIONS,
  MARKETS,
  Mention,
  OWNERS,
  SENTIMENTS,
} from "../../../features/youtube-intelligence/contracts.ts";
import {
  GICS_SECTORS,
  MACRO_THEMES,
  SECTOR_SUBTHEMES,
} from "../../../features/youtube-intelligence/instrument-kind.ts";
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
const researchContextSchema = {
  ...claimSchema,
  properties: Object.fromEntries(Object.entries(claimSchema.properties).filter(([key])=>key!=="levels")),
  required: claimSchema.required.filter(key=>key!=="levels"),
  additionalProperties: false,
};
/**
 * Prompt v9 asks for structured ideas: what the creator did, whose view it is,
 * option terms, size, conditional levels and dated catalysts. Earlier prompt
 * versions keep the schema above, so their requests are unchanged.
 */
const levelKinds = [...claimSchema.properties.levels.items.properties.kind.enum, "threshold"];
const structuredClaimSchema = {
  ...claimSchema,
  properties: {
    ...claimSchema.properties,
    levels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: levelKinds },
          value_original: { type: "string" },
          condition_en: stringOrNull,
        },
        required: ["kind", "value_original", "condition_en"],
      },
    },
    action: { type: "string", enum: [...ACTIONS] },
    owner: { type: "string", enum: [...OWNERS] },
    owner_name: stringOrNull,
    option: {
      type: "object",
      nullable: true,
      properties: {
        right: { type: "string", enum: ["call", "put"] },
        side: { type: "string", enum: ["long", "short"] },
        strike_original: stringOrNull,
        expiry_original: stringOrNull,
        premium_original: stringOrNull,
      },
      required: ["right", "side", "strike_original", "expiry_original", "premium_original"],
    },
    size_original: stringOrNull,
    catalysts: {
      type: "array",
      items: {
        type: "object",
        properties: { text_en: { type: "string" }, date_original: stringOrNull },
        required: ["text_en", "date_original"],
      },
    },
  },
  required: [...claimSchema.required, "action", "owner", "owner_name", "option", "size_original", "catalysts"],
};
const transcriptionDoubtSchema = {
  type: "object",
  properties: {
    start_id: { type: "string", minLength: 1 },
    end_id: { type: "string", minLength: 1 },
    heard: { type: "string", minLength: 1 },
    likely: { type: "string", minLength: 1 },
    reason_en: { type: "string", minLength: 1 },
  },
  required: ["start_id", "end_id", "heard", "likely", "reason_en"],
};
export const extractionResponseSchema = {
  type: "object",
  properties: {
    claims: { type: "array", maxItems: 40, items: claimSchema },
    key_points: { type: "array", maxItems: 30, items: researchContextSchema },
    mentions: { type: "array", maxItems: 200, items: mentionSchema },
  },
  required: ["claims", "key_points", "mentions"],
};
export const structuredExtractionResponseSchema = {
  type: "object",
  properties: {
    claims: { type: "array", maxItems: 40, items: structuredClaimSchema },
    key_points: { type: "array", maxItems: 30, items: researchContextSchema },
    mentions: { type: "array", maxItems: 200, items: mentionSchema },
    transcription_doubts: { type: "array", maxItems: 30, items: transcriptionDoubtSchema },
  },
  required: ["claims", "key_points", "mentions", "transcription_doubts"],
};
/**
 * Call fields (F60, prompt v11): the structured-idea contract of v9/v10 plus an
 * expiry and a macro/sector theme on each claim. Action and catalysts come from
 * the structured-idea fields, not a second copy. Used only by prompt versions
 * that declare `callFields`, so every earlier version keeps its request bytes.
 * The application parses level numbers itself.
 */
const callFieldsClaimSchema = {
  ...structuredClaimSchema,
  properties: {
    ...structuredClaimSchema.properties,
    expiry: {
      type: "object",
      nullable: true,
      properties: {
        date: stringOrNull,
        original: { type: "string", minLength: 1 },
      },
      required: ["date", "original"],
    },
    macro_theme: {
      type: "string",
      nullable: true,
      enum: [
        ...MACRO_THEMES,
        ...GICS_SECTORS,
        ...SECTOR_SUBTHEMES.map((s) => `${s.sector} / ${s.name}`),
      ],
    },
  },
};
export const callFieldsExtractionResponseSchema = {
  ...structuredExtractionResponseSchema,
  properties: {
    ...structuredExtractionResponseSchema.properties,
    claims: { type: "array", maxItems: 40, items: callFieldsClaimSchema },
  },
};
/** The response schema a prompt version asks for. */
export function extractionSchemaFor(prompts: { structuredIdeas?: boolean; callFields?: boolean }) {
  if (prompts.callFields) return callFieldsExtractionResponseSchema;
  return prompts.structuredIdeas ? structuredExtractionResponseSchema : extractionResponseSchema;
}
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
const KeyPointExtraction = RangeSelectedClaim.extend({ levels: RangeSelectedClaim.shape.levels.default([]) });
const TranscriptionDoubt = z.object({
  start_id: z.string().min(1),
  end_id: z.string().min(1),
  heard: z.string().min(1),
  likely: z.string().min(1),
  reason_en: z.string().min(1),
});
export const PointerExtraction = z.object({
  claims: z.array(RangeSelectedClaim).max(40),
  key_points: z.array(KeyPointExtraction).max(30).default([]),
  mentions: z.array(MentionExtraction).max(200).default([]),
  /** Prompt v9: words that look misheard, with what was likely said. Shown as a doubt, never applied. */
  transcription_doubts: z.array(TranscriptionDoubt).max(30).default([]),
});
export type PointerExtractionData = z.infer<typeof PointerExtraction>;
export type { RangeSelectedClaimData };
export function parsePointerExtraction(raw: unknown): PointerExtractionData {
  return PointerExtraction.parse(raw);
}
export type DroppedExtractionItem = { kind: string; index: number; item: unknown; reason: string };
/**
 * Parse an extraction reply, keeping every valid item when some are not. One
 * malformed field (say Chinese text in an English field) used to fail the
 * whole reply and so the whole run; now only that item is dropped, with the
 * reason. A reply whose shape is wrong, or that exceeds the item limits, still
 * fails as before.
 */
export function salvagePointerExtraction(raw: unknown): { extraction: PointerExtractionData; dropped: DroppedExtractionItem[] } {
  const strict = PointerExtraction.safeParse(raw);
  if (strict.success) return { extraction: strict.data, dropped: [] };
  const envelope = z
    .object({
      claims: z.array(z.unknown()).max(40),
      key_points: z.array(z.unknown()).max(30).default([]),
      mentions: z.array(z.unknown()).max(200).default([]),
      transcription_doubts: z.array(z.unknown()).max(30).default([]),
    })
    .safeParse(raw);
  if (!envelope.success) throw strict.error;
  const dropped: DroppedExtractionItem[] = [];
  const keep = <T,>(schema: z.ZodType<T>, items: unknown[], kind: string) =>
    items.flatMap((item, index) => {
      const parsed = schema.safeParse(item);
      if (parsed.success) return [parsed.data];
      dropped.push({ kind, index, item, reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      return [];
    });
  return {
    extraction: {
      claims: keep(RangeSelectedClaim, envelope.data.claims, "claim"),
      key_points: keep(KeyPointExtraction, envelope.data.key_points, "key_point"),
      mentions: keep(MentionExtraction, envelope.data.mentions, "mention"),
      transcription_doubts: keep(TranscriptionDoubt, envelope.data.transcription_doubts, "transcription_doubt"),
    },
    dropped,
  };
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


export const RESEARCH_CONTEXT_POLICY = " OUTPUT CONTRACT OVERRIDE: return claims, key_points and mentions, even if a historical format printed above omits key_points. Claims require a supported creator investment stance/action; key_points are material research context and require NO trading stance, newness or ticker. Central-bank actions and guidance, inflation, discount rates, financing/liquidity, earnings and risk inputs are material when they causally inform the video's valuation, thesis, countercase or monitoring criteria. Standard, descriptive or widely known information is not immaterial for that reason. Preserve actual observations separately from forecasts, conditions and hypothetical examples. In key_points do NOT output a levels field: reported prices, policy rates, hypothetical yields, valuation multiples and third-party forecasts are not creator entry/support/resistance/stop instructions. Keep all quantities, units, dates, conditions and assumptions in thesis_en and exact source evidence ranges. Trade-role levels belong only to actual creator claims with supporting action evidence. No inference of a trade from a descriptive number.";
export function normalizeResearchContextLevels(extraction:PointerExtractionData){
 const diagnostics: {index:number;original:PointerExtractionData['key_points'][number];reason:string}[]=[];
 return {extraction:{...extraction,key_points:extraction.key_points.map((point,index)=>{
  if(!point.levels.length)return point;
  diagnostics.push({index,original:point,reason:"Removed trade-level roles from a research context item; original values remain here and in the model response, while thesis, source ranges and conditions remain unchanged."});
  return {...point,levels:[]};
 })},diagnostics};
}
