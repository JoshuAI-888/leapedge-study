import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTrustLevel } from "../src/features/youtube-intelligence/trust.ts";
import { freshDatabase } from "./helpers/db.ts";
import {
  upsertClaim,
  claimsForRun,
} from "../src/server/youtube-intelligence/repos/claims.ts";
import { upsertEvidenceSpan } from "../src/server/youtube-intelligence/repos/evidence-spans.ts";
import {
  signClaimReview,
  requestAudioTrust,
} from "../src/server/youtube-intelligence/actions/trust.ts";
import {
  create,
  reserve,
  get,
} from "../src/server/youtube-intelligence/store.ts";
import { listJobs } from "../src/server/youtube-intelligence/repos/jobs.ts";
import { reviewsForClaim } from "../src/server/youtube-intelligence/repos/reviews.ts";
const checks = {
  structural: true,
  pointerEvidence: true,
  priceTicker: true,
  criticAccepted: true,
};
const agreement = [
  { agreed: true, agreementScore: 1, anchorErrorSeconds: 0, independent: true },
];
test("Trust ladder requires every text check and independent agreement for every cited span", () => {
  assert.equal(
    computeTrustLevel({ ...checks, pointerEvidence: false }, agreement, [])
      .trustLevel,
    "L0",
  );
  assert.equal(computeTrustLevel(checks, [], []).trustLevel, "L1");
  assert.equal(computeTrustLevel(checks, agreement, []).trustLevel, "L2");
  assert.equal(
    computeTrustLevel(
      checks,
      [...agreement, { ...agreement[0], agreed: false }],
      [],
    ).trustLevel,
    "L1",
  );
  assert.equal(
    computeTrustLevel(checks, [{ ...agreement[0], independent: false }], [])
      .trustLevel,
    "L1",
  );
});
test("Human level requires a named signed review of the listened span, never a model verdict", () => {
  assert.equal(
    computeTrustLevel(checks, agreement, [
      {
        verdict: "accept",
        reviewerAccountId: "",
        signedAt: null,
        listenedSpan: null,
      },
    ]).trustLevel,
    "L2",
  );
  assert.equal(
    computeTrustLevel(
      checks,
      agreement,
      [
        {
          verdict: "verified",
          reviewerAccountId: "owner-1",
          signedAt: "2026-09-19T00:00:00Z",
          listenedSpan: {
            startSeconds: 10,
            endSeconds: 14,
            contentDigest: "exact",
          },
        },
      ],
      "exact",
    ).trustLevel,
    "L3",
  );
});

test("Unbound and stale signed reviews cannot confer L3, and the latest matching verdict controls", () => {
  const review = {
    reviewerAccountId: "owner",
    verdict: "verified",
    signedAt: "2026-09-19T00:00:00Z",
    listenedSpan: { startSeconds: 0, endSeconds: 5, contentDigest: "old" },
  };
  assert.equal(
    computeTrustLevel(checks, agreement, [review], "new").trustLevel,
    "L2",
  );
  assert.equal(computeTrustLevel(checks, agreement, [review]).trustLevel, "L2");
  assert.equal(
    computeTrustLevel(
      checks,
      agreement,
      [
        review,
        { ...review, verdict: "rejected", signedAt: "2026-09-19T00:00:01Z" },
      ],
      "old",
    ).trustLevel,
    "L0",
  );
});

test("Signing authenticates reviewer identity, validates listened coverage, and persists an append-only L3", async () => {
  await freshDatabase();
  await upsertClaim({
    id: "c",
    runId: "r",
    videoId: "abcdefghijk",
    channelId: null,
    instrument: "Nvidia",
    ticker: "NVDA",
    tickerExplicit: true,
    stance: "long",
    thesisEn: "Buy",
    horizonEn: null,
    conditionsEn: [],
    risksEn: [],
    creatorConviction: "high",
    ...computeTrustLevel(checks, [], []),
    configHash: null,
    publishedAt: null,
  });
  await upsertEvidenceSpan({
    claimId: "c",
    ordinal: 0,
    startId: "s1",
    endId: "s1",
    startSeconds: 10,
    endSeconds: 14,
    textOriginal: "Buy NVDA",
    textHash: null,
    translationEn: null,
    agreementScore: null,
    anchorErrorSeconds: null,
    tieBreakSource: null,
  });
  const review = {
    claimId: "c",
    verdict: "verified",
    note: "I listened to the complete span.",
    listenedSpan: { startSeconds: 10, endSeconds: 14 },
  };
  await assert.rejects(() => signClaimReview(review, ""));
  await assert.rejects(() =>
    signClaimReview({ ...review, reviewerAccountId: "forged" }, "owner"),
  );
  await assert.rejects(
    () =>
      signClaimReview(
        { ...review, listenedSpan: { startSeconds: 11, endSeconds: 14 } },
        "owner",
      ),
    /every cited/,
  );
  await signClaimReview(review, "owner");
  assert.equal((await claimsForRun("r"))[0].trustLevel, "L3");
  assert.equal((await reviewsForClaim("c"))[0].reviewerAccountId, "owner");
  const signed = (await claimsForRun("r"))[0];
  await upsertClaim({ ...signed, createdAt: undefined, trustLevel: "L1" });
  assert.equal(
    (await claimsForRun("r"))[0].trustLevel,
    "L3",
    "unchanged recompute preserves signature",
  );
  await signClaimReview(
    { ...review, verdict: "rejected", note: "On replay the quote is wrong." },
    "owner",
  );
  assert.equal(
    (await claimsForRun("r"))[0].trustLevel,
    "L0",
    "latest rejection revokes scoring eligibility",
  );
  await upsertClaim({ ...signed, createdAt: undefined, trustLevel: "L2" });
  const rejected = (await claimsForRun("r"))[0];
  assert.equal(
    rejected.trustLevel,
    "L0",
    "audio recompute cannot restore rejected content",
  );
  assert.match(
    (rejected.trustBasis as { humanReviewReason: string }).humanReviewReason,
    /excluded from scoring/,
  );
  assert.equal(
    (await reviewsForClaim("c")).length,
    2,
    "audit remains append-only",
  );
  await signClaimReview(review, "owner");
  const verified = (await claimsForRun("r"))[0];
  await upsertClaim({
    ...verified,
    createdAt: undefined,
    thesisEn: "Sell",
    trustLevel: "L1",
  });
  assert.equal(
    (await claimsForRun("r"))[0].trustLevel,
    "L1",
    "changed claim cannot inherit signature",
  );
  await upsertClaim({ ...verified, createdAt: undefined, trustLevel: "L1" });
  await signClaimReview(review, "owner");
  const { spansForClaim } =
    await import("../src/server/youtube-intelligence/repos/evidence-spans.ts");
  const spans = await spansForClaim("c");
  await upsertClaim({ ...verified, createdAt: undefined, trustLevel: "L1" }, [
    { ...spans[0], textOriginal: "Do not buy NVDA", textHash: "different" },
  ]);
  assert.equal(
    (await claimsForRun("r"))[0].trustLevel,
    "L1",
    "changed evidence cannot inherit signature",
  );
  await assert.rejects(
    () =>
      upsertClaim({
        ...verified,
        createdAt: undefined,
        thesisEn: "Different",
        trustLevel: "L3",
      }),
    /exact content/,
  );
});

test("Explicit audio recovery requeues captionless held runs and preserves source checkpoints", async () => {
  const db = await freshDatabase();
  const run = await create("abcdefghijk", "fixture", {}, "fixture");
  const checkpoint = {
    metadata: { duration: 601 },
    asrWindows: [{ transcriptId: "retained-window" }],
    asrPlan: [{ startSeconds: 0, endSeconds: 300 }],
  };
  await db
    .prepare(
      "UPDATE yi_runs SET status='needs_review',stage='source',output=$1 WHERE id=$2",
    )
    .run(JSON.stringify(checkpoint), run.id);
  const recovered = (await requestAudioTrust(run.id))!;
  assert.equal(recovered.stage, "asr-source");
  assert.equal(recovered.status, "queued");
  assert.equal(recovered.input.audioTrustRequested, true);
  assert.deepEqual(recovered.output, checkpoint);
  await assert.rejects(() => requestAudioTrust(run.id), /processing|resumable/);
  assert.equal(
    (await listJobs()).filter((j) => j.id.startsWith("audio-trust:")).length,
    1,
  );
});

test("Metadata recovery resumes metadata, and uncertain provider holds block every paid retry", async () => {
  const db = await freshDatabase();
  const run = await create("abcdefghijk", "fixture", {}, "fixture");
  await db
    .prepare("UPDATE yi_runs SET status='failed',stage='metadata' WHERE id=$1")
    .run(run.id);
  assert.equal((await requestAudioTrust(run.id))!.stage, "metadata");
  await db
    .prepare(
      "UPDATE yi_runs SET status='failed',stage='asr-source' WHERE id=$1",
    )
    .run(run.id);
  await reserve(run.id, "transcribe-asr-0-300", 0.01);
  await assert.rejects(() => requestAudioTrust(run.id), /unresolved provider/);
  assert.equal((await get(run.id))!.status, "failed");
  await db
    .prepare("UPDATE yi_runs SET stage='critique' WHERE id=$1")
    .run(run.id);
  await assert.rejects(() => requestAudioTrust(run.id), /resumable/);
});
