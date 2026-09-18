import { createHash } from "node:crypto";
import type {
  CheckedClaim,
  MentionData,
  Run,
  SourceData,
} from "../../../features/youtube-intelligence/contracts.ts";
import { upsertClaim, type ClaimInput } from "./claims.ts";
import { upsertMention, type MentionRow } from "./mentions.ts";
import {
  upsertEvidenceSpan,
  type EvidenceSpanRow,
} from "./evidence-spans.ts";
/**
 * Not a table module: the one mapping from a completed run to the rows the
 * claim tables hold, so the publish stage and the one-off document migration
 * cannot disagree about what a row looks like.
 *
 * Every id is derived from the run and the item's position within it, which is
 * what makes writing twice a no-op: the primary keys are the guard, no lock is
 * held across the write, and a run republished after a resume rewrites its own
 * rows rather than adding a second set.
 */
export type RunRows = {
  claims: ClaimInput[];
  spans: EvidenceSpanRow[];
  mentions: MentionRow[];
};
type Metadata = {
  channelId?: unknown;
  publishedAt?: unknown;
};
function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
/**
 * What the claim was produced by, as one digest: the extraction and critique
 * models, the prompt version and the pipeline revision. A leaderboard that
 * compares configurations needs to tell two rows apart without reading the run.
 */
export function configHash(run: Run): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        run.model,
        run.promptVersion,
        text(run.input.criticModel),
        text(run.input.transcriptionModel),
        text(run.input.pipelineVersion),
      ]),
    )
    .digest("hex");
}
function secondsOf(source: SourceData | null, id: string, end: boolean) {
  const segment = source?.segments.find((s) => s.id === id);
  if (!segment) return null;
  return end ? segment.end_seconds : segment.start_seconds;
}
function spansOf(
  claimId: string,
  claim: CheckedClaim,
  source: SourceData | null,
): EvidenceSpanRow[] {
  return claim.claim.evidence.map((e, ordinal) => {
    const startId = e.source_span?.start_id ?? e.segment_id;
    const endId = e.source_span?.end_id ?? e.end_segment_id ?? e.segment_id;
    return {
      claimId,
      ordinal,
      startId,
      endId,
      startSeconds:
        e.source_span?.start_seconds ?? secondsOf(source, startId, false),
      endSeconds: e.source_span?.end_seconds ?? secondsOf(source, endId, true),
      textOriginal: e.quote_original,
      textHash:
        e.source_span?.text_hash ??
        createHash("sha256").update(e.quote_original).digest("hex"),
      translationEn: e.quote_translation_en || null,
      // The agreement score, the anchor error and the tie-break source are
      // written by the windowed-ASR work; publish leaves them unset rather
      // than inventing a value.
      agreementScore: null,
      anchorErrorSeconds: null,
      tieBreakSource: null,
    };
  });
}
/**
 * The rows one completed run produces. Only accepted claims become claim rows —
 * a rejected one keeps its reasons on the run and never enters the record —
 * while every kept mention becomes a mention row, because the sentiment count
 * is over references, not over calls.
 */
export function rowsForRun(run: Run): RunRows {
  const metadata = (run.output.metadata ?? {}) as Metadata;
  const channelId = text(metadata.channelId);
  const publishedAt = text(metadata.publishedAt);
  const source = (run.output.source as SourceData | undefined) ?? null;
  const hash = configHash(run);
  const claims: ClaimInput[] = [];
  const spans: EvidenceSpanRow[] = [];
  const published = new Set<string>();
  for (const item of (run.output.claims || []) as CheckedClaim[]) {
    if (!item.passed) continue;
    const id = `${run.id}:${item.id}`;
    published.add(item.id);
    claims.push({
      id,
      runId: run.id,
      videoId: run.videoId,
      channelId,
      instrument: item.claim.instrument_as_spoken,
      ticker: item.claim.ticker,
      tickerExplicit: item.claim.ticker_explicit,
      stance: item.claim.stance,
      thesisEn: item.claim.thesis_en,
      horizonEn: item.claim.horizon_en,
      conditionsEn: item.claim.conditions_en,
      risksEn: item.claim.risks_en,
      creatorConviction: item.claim.creator_conviction,
      // L0 is what publish can honestly assert: the structural checks and the
      // critique. Raising it is the trust ladder's job, and upsertClaim()
      // never lowers a level a later pass has already granted.
      trustLevel: "L0",
      trustBasis: {
        structural: true,
        critique: item.audit?.verdict ?? null,
        pointerEvidence: item.claim.evidence.every((e) => !!e.source_span),
        evidenceCount: item.claim.evidence.length,
      },
      configHash: hash,
      publishedAt,
      createdAt: run.createdAt,
    });
    spans.push(...spansOf(id, item, source));
  }
  const mentions: MentionRow[] = (
    (run.output.mentions || []) as MentionData[]
  ).map((mention, index) => ({
    id: `${run.id}:m${index + 1}`,
    runId: run.id,
    videoId: run.videoId,
    channelId,
    ticker: mention.ticker,
    stance: mention.stance,
    sentiment: mention.sentiment ?? "neutral",
    isCall: mention.is_call === true,
    claimId:
      mention.claim_id && published.has(mention.claim_id)
        ? `${run.id}:${mention.claim_id}`
        : null,
    trustLevel: "L0",
    spanId: mention.source_span?.start_id ?? null,
    publishedAt,
  }));
  return { claims, spans, mentions };
}
/**
 * Write one run's rows. Claims first, then their spans, then the mentions that
 * point at them, so an interrupted write never leaves a mention referring to a
 * claim row that is not there yet.
 */
export async function writeRunRows(rows: RunRows) {
  for (const claim of rows.claims) await upsertClaim(claim);
  for (const span of rows.spans) await upsertEvidenceSpan(span);
  for (const mention of rows.mentions) await upsertMention(mention);
  return {
    claims: rows.claims.length,
    spans: rows.spans.length,
    mentions: rows.mentions.length,
  };
}
