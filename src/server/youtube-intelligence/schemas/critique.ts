import { resolveListing } from "../../../features/youtube-intelligence/identity.ts";
import { z } from "zod";
import type {
  ClaimData,
  MentionData,
  SourceData,
} from "../../../features/youtube-intelligence/contracts.ts";
/**
 * The batched critique (spec 4.3): one call per run over every claim, key
 * point and mention, answered by id.
 *
 * The per-claim loop this replaces re-sent the transcript once per claim, so
 * the transcript cost was multiplied by the claim count and the critic could
 * never see two claims at once. One call with every id in it costs the
 * transcript once — or nothing, when it comes from an explicit context cache —
 * and lets the critic say that two claims contradict each other, which is what
 * `cross_claim_notes` records.
 */
export const CritiqueVerdict = z.object({
  /** The id the request supplied: c1..cn for claims, k1..kn for key points, m1..mn for mentions. */
  id: z.string().min(1),
  verdict: z.enum(["accept", "reject"]),
  reason_en: z.string().min(1),
  /** Set only when another supplied id contradicts or qualifies this one. */
  cross_claim_notes: z.preprocess(
    (value) => (typeof value === "string" && !value.trim() ? undefined : value),
    z.string().min(1).optional(),
  ),
});
export type CritiqueVerdictData = z.infer<typeof CritiqueVerdict>;
/**
 * The root is an object, not the bare array the stage conceptually returns:
 * several structured-output implementations reject a root array, so the same
 * envelope the translation stage uses is used here. `parseCritique` accepts
 * either, because a critic that answers with a bare array is still answering.
 */
export const CritiqueResponse = z.object({
  verdicts: z.array(CritiqueVerdict).max(400),
});
export type CritiqueResponseData = z.infer<typeof CritiqueResponse>;
export function parseCritique(raw: unknown): CritiqueVerdictData[] {
  const verdicts = Array.isArray(raw)
    ? z.array(CritiqueVerdict).max(400).parse(raw)
    : CritiqueResponse.parse(raw).verdicts;
  const seen = new Set<string>();
  for (const verdict of verdicts) {
    if (seen.has(verdict.id))
      throw Error(`The critic returned two verdicts for ${verdict.id}.`);
    seen.add(verdict.id);
  }
  return verdicts;
}
/** Plain JSON schema for ModelRequest.responseSchema; no zod-to-JSON conversion at the boundary. */
export const critiqueResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      maxItems: 400,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["accept", "reject"] },
          reason_en: { type: "string" },
          cross_claim_notes: { type: "string" },
        },
        required: ["id", "verdict", "reason_en"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
};
/**
 * Appended to the prompt snapshot's own critique instruction. The registered
 * prompt versions ask for one verdict object because they were written for the
 * per-claim loop; the snapshots are immutable, so the batched shape is stated
 * here and overrides the older sentence explicitly.
 */
export const CRITIQUE_BATCH_FORMAT =
  'This is one batched audit over every item in SOURCE DATA. Each item carries an id. Return {"verdicts":[{"id":str,"verdict":"accept|reject","reason_en":str,"cross_claim_notes":str}]} with exactly one entry for every supplied id and no id that was not supplied; ignore any earlier instruction to return a single verdict object for one claim. reason_en is one English sentence. Use cross_claim_notes only where another supplied item contradicts or qualifies this one, naming that id. An id beginning with k is a contextual key point: it need not recommend a trade, so audit evidence, attribution and meaning and do not reject it solely for the absence of an action. An id beginning with m is a mention: audit the instrument identity, the stance and the sentiment against its cited span only. Judge every item independently against the source; a verdict on one id must not be inferred from another. The transcript may be supplied from a context cache instead of in SOURCE DATA: audit against whichever is present and never answer from memory. listingIdentity, when present, is a separately sourced company-to-listing mapping. The claim ticker and copied quotes preserve the literal caption spelling; do not reject an otherwise supported company thesis solely because that literal spelling differs from listingIdentity.ticker. Still reject ambiguous company identity, unsupported actions or financial semantics. Options strikes are not stock entries; expiry and conditional triggers must survive. Hypothetical returns alone are contextual key points, not actionable calls.';
/** What the request says in place of the transcript when the transcript is in the cache. */
export const CACHED_SOURCE_NOTE =
  "The full transcript is supplied to this call from the explicit context cache. Audit against it; it is the same retained source the ids below cite.";
export type CritiqueClaimItem = {
  id: string;
  kind: "claim" | "key_point";
  claim: ClaimData;
};
export type CritiqueMentionItem = { id: string; mention: MentionData };
/**
 * The payload for one critique call. The source comes first so an implicit
 * cache can match the prefix (spec 5), and the claims and mentions carry only
 * the id the verdict must name plus the fields the critic audits.
 */
export function critiquePayload(input: {
  claims: CritiqueClaimItem[];
  mentions: CritiqueMentionItem[];
  segments?: SourceData["segments"];
  scope?: string;
  chunk?: { index: number; total: number };
}) {
  const chunked = input.chunk && input.chunk.total > 1;
  return {
    source: input.segments
      ? {
          scope:
            input.scope ??
            (chunked ? "chronological transcript excerpt" : "full transcript"),
          segments: input.segments,
        }
      : CACHED_SOURCE_NOTE,
    ...(chunked
      ? { chunk: input.chunk!.index + 1, totalChunks: input.chunk!.total }
      : {}),
    claims: input.claims.map((item) => ({
      id: item.id,
      kind: item.kind,
      claim: item.claim,
      listingIdentity: resolveListing(
        item.claim.instrument_as_spoken,
        item.claim.ticker,
      ),
    })),
    mentions: input.mentions.map((item) => ({
      id: item.id,
      mention: item.mention,
    })),
  };
}
/**
 * Output cap for one batched call: every id needs room for a verdict and a
 * sentence, so the cap grows with the batch instead of staying at the
 * per-claim figure, and stays inside a bound no batch can talk past.
 */
export function critiqueOutputTokens(items: number, configured?: number) {
  return Math.min(
    48000,
    Math.max(configured || 3000, 400 * Math.max(1, items)),
  );
}
