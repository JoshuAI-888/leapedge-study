import { z } from "zod";
import { randomUUID } from "node:crypto";
import { database } from "../database.ts";
import { get } from "../store.ts";
import { teamPreferences } from "../research-store.ts";
import {
  claimsForRun,
  upsertClaim,
  claimContentDigest,
} from "../repos/claims.ts";
import { spansForClaim } from "../repos/evidence-spans.ts";
import { appendReview, reviewsForClaim } from "../repos/reviews.ts";
import { enqueueJob } from "../repos/jobs.ts";
import {
  computeTrustLevel,
  TrustChecks,
} from "../../../features/youtube-intelligence/trust.ts";
import { Agreement } from "../../../features/youtube-intelligence/agreement.ts";
import { writes, type ActionTable } from "./types.ts";

export const ReviewInput = z.strictObject({
  claimId: z.string().min(1),
  verdict: z.enum(["verified", "rejected"]),
  note: z.string().trim().min(1).max(4000),
  listenedSpan: z
    .strictObject({
      startSeconds: z.number().nonnegative(),
      endSeconds: z.number().positive(),
    })
    .refine((s) => s.endSeconds > s.startSeconds),
});
/** Account identity comes from the server, never from the submitted review payload. */
export async function signClaimReview(input: unknown, accountId: string) {
  const v = ReviewInput.parse(input);
  const reviewerAccountId = z.string().trim().min(1).parse(accountId);
  return database.transaction(async () => {
    const row = (await database
      .prepare("SELECT run_id FROM claims WHERE id=$1 FOR UPDATE")
      .get(v.claimId)) as { run_id: string } | undefined;
    if (!row) throw Error("Claim not found.");
    const claim = (await claimsForRun(row.run_id)).find(
      (c) => c.id === v.claimId,
    )!;
    const spans = await spansForClaim(v.claimId);
    if (
      !spans.length ||
      spans.some(
        (s) =>
          s.startSeconds === null ||
          s.endSeconds === null ||
          s.startSeconds < v.listenedSpan.startSeconds ||
          s.endSeconds > v.listenedSpan.endSeconds,
      )
    )
      throw Error("The listened span must cover every cited evidence span.");
    const checks = TrustChecks.parse(claim.trustBasis);
    if (v.verdict === "verified" && !Object.values(checks).every(Boolean))
      throw Error("A claim must pass text checks before it can be signed.");
    const contentDigest = claimContentDigest(claim, spans);
    const previous = await reviewsForClaim(v.claimId);
    const signedAt = new Date(
      Math.max(
        Date.now(),
        ...previous
          .map((r) => Date.parse(r.signedAt ?? "") + 1)
          .filter(Number.isFinite),
      ),
    ).toISOString();
    const review = {
      id: randomUUID(),
      claimId: v.claimId,
      reviewerAccountId,
      verdict: v.verdict,
      note: v.note,
      listenedSpan: { ...v.listenedSpan, contentDigest },
      signedAt,
    };
    await appendReview(review);
    const agreements = Agreement.array().parse(
      (claim.trustBasis as { agreement?: unknown }).agreement ?? [],
    );
    const trust = computeTrustLevel(
      checks,
      agreements,
      await reviewsForClaim(v.claimId),
      contentDigest,
    );
    await upsertClaim({
      ...claim,
      ...trust,
      createdAt: claim.createdAt ?? undefined,
    });
    return { review, ...trust };
  });
}

export async function requestAudioTrust(runId: string) {
  const settings = await teamPreferences();
  if (settings.sources.asr !== "gemini-windowed")
    throw Error("Enable windowed ASR before requesting audio agreement.");
  return database.transaction(async () => {
    await database
      .prepare("SELECT id FROM yi_runs WHERE id=$1 FOR UPDATE")
      .get(runId);
    const run = await get(runId);
    const sourceRecovery =
      !!run &&
      ["needs_review", "failed"].includes(run.status) &&
      ["metadata", "source", "asr-source"].includes(run.stage);
    if (
      !run ||
      run.input.task ||
      (!sourceRecovery && (run.status !== "completed" || !run.output.source))
    )
      throw Error(
        "Choose a completed analysis or a resumable metadata/source failure; queued and running jobs are already processing.",
      );
    if (run.output.audioTrustProcessed)
      throw Error(
        "Audio agreement was already attempted; inspect its evidence before requesting another paid run.",
      );
    const held = await database
      .prepare(
        "SELECT id FROM yi_calls WHERE run_id=$1 AND status IN ('reserved','unknown') LIMIT 1",
      )
      .get(runId);
    if (held)
      throw Error(
        "This run has an unresolved provider hold. Reconcile it before requesting paid recovery.",
      );
    const metadata = z
      .object({ duration: z.number().positive() })
      .safeParse(run.output.metadata);
    const stage = sourceRecovery
      ? metadata.success
        ? "asr-source"
        : "metadata"
      : "asr-evidence";
    const input = {
      ...run.input,
      audioTrustRequested: true,
      audioTrustConfig: settings,
    };
    const changed = await database
      .prepare(
        "UPDATE yi_runs SET status='queued',stage=$1,input=$2::jsonb,error=NULL,lease_until=0,lease_token=NULL,updated_at=$3 WHERE id=$4 AND status=$5",
      )
      .run(
        stage,
        JSON.stringify(input),
        new Date().toISOString(),
        runId,
        run.status,
      );
    if (!changed.changes) throw Error("This run is already processing.");
    // A new queue lease may retry a terminal job; the model ledger and retained
    // window checkpoints still prevent repeating any previously billed call.
    const queued = await enqueueJob({
      id: `audio-trust:${runId}:${randomUUID()}`,
      kind: "analyze",
      payload: { runId },
    });
    if (!queued) throw Error("Audio verification was already queued.");
    return await get(runId);
  });
}

export const trust: ActionTable = {
  signClaimReview: writes(ReviewInput, (v) => {
    const account = process.env.YTI_REVIEWER_ACCOUNT_ID;
    if (!account)
      throw Error(
        "A server-identified reviewer account is required to sign evidence.",
      );
    return signClaimReview(v, account);
  }),
  requestAudioTrust: writes(z.strictObject({ runId: z.string().min(1) }), (v) =>
    requestAudioTrust(v.runId),
  ),
};
