import { createHash } from "node:crypto";
import {
  deriveEvidence,
  validateClaim,
} from "../../../features/youtube-intelligence/contracts.ts";
import { Agreement } from "../../../features/youtube-intelligence/agreement.ts";
import {
  computeTrustLevel,
  TrustChecks,
} from "../../../features/youtube-intelligence/trust.ts";
import { reviewsForClaim } from "./reviews.ts";
import type {
  CheckedClaim,
  MentionData,
  Run,
  SourceData,
} from "../../../features/youtube-intelligence/contracts.ts";
import {
  deleteClaimsForRunExcept,
  upsertClaim,
  claimContentDigest,
  type ClaimInput,
} from "./claims.ts";
import {
  deleteMentionsForRunExcept,
  upsertMention,
  type MentionRow,
} from "./mentions.ts";
import {
  deleteSpansBeyond,
  deleteSpansForClaims,
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
  runId: string;
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
  agreements: ReturnType<typeof Agreement.parse>[] = [],
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
      // Only independently acquired per-span measurements are persisted.
      agreementScore: agreements[ordinal]?.agreementScore ?? null,
      anchorErrorSeconds: agreements[ordinal]?.anchorErrorSeconds ?? null,
      tieBreakSource: agreements[ordinal]?.tieBreakSource ?? null,
    };
  });
}
/**
 * The rows one completed run produces. Only accepted claims become claim rows —
 * a rejected one keeps its reasons on the run and stays out of the record, and
 * writeRunRows() takes back the row of one that was accepted on an earlier
 * pass — while every kept mention becomes a mention row, because the sentiment
 * count is over references, not over calls.
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
    const rawAgreement = (
      run.output.spanAgreement as Record<string, unknown> | undefined
    )?.[item.id];
    const parsedAgreement = Agreement.array().safeParse(rawAgreement ?? []);
    const agreements =
      parsedAgreement.success &&
      parsedAgreement.data.length === item.claim.evidence.length
        ? parsedAgreement.data
        : [];
    const pointerEvidence =
      !!source &&
      item.claim.evidence.length > 0 &&
      item.claim.evidence.every((e) => {
        if (!e.source_span) return false;
        try {
          const derived = deriveEvidence(source, e.source_span);
          return (
            derived.text_hash === e.source_span.text_hash &&
            derived.quote_original === e.quote_original
          );
        } catch {
          return false;
        }
      });
    const trust = computeTrustLevel(
      {
        structural: item.passed && item.reasons.length === 0,
        pointerEvidence,
        priceTicker: !!source && validateClaim(item.claim, source).length === 0,
        criticAccepted: item.audit?.verdict === "accept",
      },
      agreements,
      [],
    );
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
      // Pointer integrity, deterministic financial checks and independent
      // span agreement determine trust; human signatures are loaded on write.
      ...trust,
      configHash: hash,
      publishedAt,
      createdAt: run.createdAt,
    });
    spans.push(...spansOf(id, item, source, agreements));
  }
  const mentions: MentionRow[] = (
    (run.output.mentions || []) as MentionData[]
  ).map((mention, index) => ({
    // The index is padded because the id is also the sort key: `m10` has to
    // follow `m9`, and the table keeps no ordinal of its own.
    id: `${run.id}:m${String(index + 1).padStart(4, "0")}`,
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
    trustLevel:
      !!mention.source_span &&
      ((run.output.mentionChecks ?? {}) as Record<string, boolean>)[
        `${mention.ticker ?? mention.instrument_as_spoken}:${mention.source_span.start_id}:${mention.source_span.end_id}`
      ]
        ? "L1"
        : "L0",
    spanId: mention.source_span?.start_id ?? null,
    publishedAt,
  }));
  return { runId: run.id, claims, spans, mentions };
}
/**
 * Write one run's rows. Claims first, then their spans, then the mentions that
 * point at them, so an interrupted write never leaves a mention referring to a
 * claim row that is not there yet.
 *
 * The rows the run no longer produces are then taken back, because the record
 * has to be what the run says now rather than the union of every pass it has
 * made: a claim accepted once and rejected on a re-critique would otherwise
 * stay in the table the leaderboard reads. Reconciling is still one statement
 * per row and holds no lock, so the resume path is unchanged — a second pass
 * over the same output writes the same rows and deletes nothing.
 */
export async function writeRunRows(rows: RunRows) {
  for (const claim of rows.claims) {
    const basis = TrustChecks.safeParse(claim.trustBasis);
    if (basis.success) {
      const agreements = Agreement.array().parse(
        (claim.trustBasis as { agreement?: unknown }).agreement ?? [],
      );
      const spans = rows.spans.filter((s) => s.claimId === claim.id);
      const reviews = (await reviewsForClaim(claim.id)).filter((r) => {
        const listened = r.listenedSpan as {
          startSeconds?: number;
          endSeconds?: number;
        } | null;
        return (
          !!listened &&
          spans.length > 0 &&
          spans.every(
            (s) =>
              s.startSeconds !== null &&
              s.endSeconds !== null &&
              typeof listened.startSeconds === "number" &&
              typeof listened.endSeconds === "number" &&
              listened.startSeconds <= s.startSeconds &&
              listened.endSeconds >= s.endSeconds,
          )
        );
      });
      Object.assign(
        claim,
        computeTrustLevel(
          basis.data,
          agreements,
          reviews,
          claimContentDigest(claim, spans),
        ),
      );
    }
    await upsertClaim(
      claim,
      rows.spans.filter((s) => s.claimId === claim.id),
    );
  }
  for (const span of rows.spans) await upsertEvidenceSpan(span);
  for (const mention of rows.mentions) {
    if (
      mention.claimId &&
      rows.spans.some(
        (s) => s.claimId === mention.claimId && s.startId === mention.spanId,
      )
    )
      mention.trustLevel =
        rows.claims.find((c) => c.id === mention.claimId)?.trustLevel ??
        mention.trustLevel;
    await upsertMention(mention);
  }
  const kept = rows.claims.map((c) => c.id);
  await deleteSpansForClaims(await deleteClaimsForRunExcept(rows.runId, kept));
  const cited = new Map<string, number>();
  for (const span of rows.spans)
    cited.set(span.claimId, (cited.get(span.claimId) ?? 0) + 1);
  // A claim that survives but cites fewer ranges than it did leaves the spans
  // past its new last ordinal behind, since those keys are never overwritten.
  for (const id of kept) await deleteSpansBeyond(id, cited.get(id) ?? 0);
  await deleteMentionsForRunExcept(
    rows.runId,
    rows.mentions.map((m) => m.id),
  );
  return {
    claims: rows.claims.length,
    spans: rows.spans.length,
    mentions: rows.mentions.length,
  };
}
