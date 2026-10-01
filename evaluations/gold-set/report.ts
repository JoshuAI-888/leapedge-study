import {
  Source,
  type CheckedClaim,
  type Run,
} from "../../src/features/youtube-intelligence/contracts.ts";
import { gradeRun, CHECK_VERSION } from "../checks.ts";
import {
  MINIMUM_VERIFIED_CASES,
  GOLD_SET_VERSION,
  claimKey,
  Sentiment,
  type GoldCaseData,
  type GoldClaimData,
  type GoldSetData,
  type SentimentValue,
  type StanceValue,
} from "./schema.ts";

/**
 * Gold-set report (spec 4.9): claim precision and recall by (ticker, stance),
 * critic precision and recall where audit verdicts exist, anchor accuracy
 * within two seconds where a person verified the anchor, sentiment agreement
 * on matched claims, and cost per accepted claim from the runs' recorded cost.
 *
 * Input runs use the research-store shapes: a Run row whose output.claims are
 * CheckedClaim[]; "accepted" means status completed and claim.passed, exactly
 * as research-store accepted(). The report is pure and deterministic.
 */
export const GOLD_REPORT_VERSION = "gold-report.v1";
export const ANCHOR_TOLERANCE_SECONDS = 2;

export type GoldReportOptions = {
  minimumVerifiedCases?: number;
  anchorToleranceSeconds?: number;
};

type Ratio = number | null;
function ratio(numerator: number, denominator: number): Ratio {
  return denominator > 0 ? numerator / denominator : null;
}

/** Deterministic sentiment of a call from its stance (spec 4.13); F13 moves this into sentiment.ts. */
export function sentimentFromStance(stance: StanceValue): SentimentValue {
  switch (stance) {
    case "long":
      return "bullish";
    case "short":
    case "avoid":
      return "bearish";
    default:
      return "neutral";
  }
}

/** Same rule as research-store accepted(): completed run, passed claims. */
export function acceptedClaims(run: Run): CheckedClaim[] {
  return run.status === "completed"
    ? ((run.output.claims || []) as CheckedClaim[]).filter((c) => c.passed)
    : [];
}

function allClaims(run: Run): CheckedClaim[] {
  return (run.output.claims || []) as CheckedClaim[];
}

/** Seconds where each piece of evidence starts: a pointer span when present (F12), else the retained segment. */
function evidenceStarts(claim: CheckedClaim, run: Run): number[] {
  const source = Source.safeParse(run.output.source);
  const byId = new Map(
    source.success ? source.data.segments.map((s) => [s.id, s.start_seconds]) : [],
  );
  const starts: number[] = [];
  for (const e of claim.claim.evidence ?? []) {
    const pointer = (e as { source_span?: { start_seconds?: unknown } }).source_span
      ?.start_seconds;
    const seconds =
      typeof pointer === "number" ? pointer : byId.get(e.segment_id) ?? null;
    if (typeof seconds === "number" && Number.isFinite(seconds)) starts.push(seconds);
  }
  return starts;
}

function claimSentiment(claim: CheckedClaim): SentimentValue {
  const own = Sentiment.safeParse((claim.claim as { sentiment?: unknown }).sentiment);
  return own.success ? own.data : sentimentFromStance(claim.claim.stance);
}

export type MatchedClaim = {
  expectedId: string;
  claimId: string;
  key: string;
  anchorErrorSeconds: number | null;
  anchorWithinTolerance: boolean | null;
  expectedSentiment: SentimentValue;
  observedSentiment: SentimentValue;
  sentimentAgrees: boolean;
};

export type GoldCaseRow = {
  caseId: string;
  videoId: string;
  language: GoldCaseData["language"];
  split: GoldCaseData["split"];
  status: GoldCaseData["status"];
  runId: string | null;
  accepted: number;
  matched: MatchedClaim[];
  unexpected: { claimId: string; ticker: string | null; stance: string }[];
  missing: { expectedId: string; key: string }[];
  grade: { pass: boolean; reason: string } | null;
};

export function goldReport(
  set: GoldSetData | GoldCaseData[],
  runs: Run[],
  options: GoldReportOptions = {},
) {
  const cases = Array.isArray(set) ? set : set.cases;
  const minimumVerifiedCases = options.minimumVerifiedCases ?? MINIMUM_VERIFIED_CASES;
  const tolerance = options.anchorToleranceSeconds ?? ANCHOR_TOLERANCE_SECONDS;
  const runByVideo = new Map<string, Run>();
  for (const r of runs) if (!runByVideo.has(r.videoId)) runByVideo.set(r.videoId, r);

  const rows: GoldCaseRow[] = [];
  const missingRun: string[] = [];
  const validityFailures: { caseId: string; runId: string; reason: string }[] = [];
  let claimTP = 0,
    claimFP = 0,
    claimFN = 0;
  let criticVerdicts = 0,
    criticTP = 0,
    criticFP = 0,
    criticFN = 0;
  let anchorsVerified = 0,
    anchorsCompared = 0,
    anchorsMeasured = 0,
    anchorsWithin = 0;
  const anchorErrors: number[] = [];
  let sentimentCompared = 0,
    sentimentAgreed = 0;
  let totalCost = 0,
    acceptedTotal = 0,
    graded = 0,
    gradePassed = 0;

  for (const c of cases) {
    const run = runByVideo.get(c.videoId);
    anchorsVerified += c.expectedClaims.filter((x) => x.anchorVerified && x.span).length;
    if (!run) {
      missingRun.push(c.videoId);
      rows.push({
        caseId: c.id,
        videoId: c.videoId,
        language: c.language,
        split: c.split,
        status: c.status,
        runId: null,
        accepted: 0,
        matched: [],
        unexpected: [],
        missing: c.expectedClaims.map((x) => ({
          expectedId: x.id,
          key: claimKey(x.ticker, x.stance),
        })),
        grade: null,
      });
      continue;
    }
    const accepted = acceptedClaims(run);
    totalCost += Number.isFinite(run.cost) ? run.cost : 0;
    acceptedTotal += accepted.length;
    const grade = gradeRun(run);
    graded++;
    if (grade.pass) gradePassed++;
    else validityFailures.push({ caseId: c.id, runId: run.id, reason: grade.reason });

    // Claim precision and recall: greedy one-to-one match on (ticker, stance).
    const expectedByKey = new Map<string, GoldClaimData>(
      c.expectedClaims.map((x) => [claimKey(x.ticker, x.stance), x]),
    );
    const unmatchedExpected = new Set(expectedByKey.keys());
    const matched: MatchedClaim[] = [];
    const unexpected: GoldCaseRow["unexpected"] = [];
    for (const a of accepted) {
      const key = a.claim.ticker ? claimKey(a.claim.ticker, a.claim.stance) : null;
      const expected = key && unmatchedExpected.has(key) ? expectedByKey.get(key) : undefined;
      if (!expected || !key) {
        claimFP++;
        unexpected.push({ claimId: a.id, ticker: a.claim.ticker, stance: a.claim.stance });
        continue;
      }
      unmatchedExpected.delete(key);
      claimTP++;
      // Anchor accuracy: nearest evidence start against the verified span start.
      let anchorErrorSeconds: number | null = null;
      let anchorWithinTolerance: boolean | null = null;
      if (expected.anchorVerified && expected.span) {
        anchorsCompared++;
        const starts = evidenceStarts(a, run);
        if (starts.length) {
          anchorsMeasured++;
          anchorErrorSeconds = Math.min(
            ...starts.map((s) => Math.abs(s - expected.span!.startSeconds)),
          );
          anchorErrors.push(anchorErrorSeconds);
          anchorWithinTolerance = anchorErrorSeconds <= tolerance;
        } else anchorWithinTolerance = false;
        if (anchorWithinTolerance) anchorsWithin++;
      }
      const observedSentiment = claimSentiment(a);
      const sentimentAgrees = observedSentiment === expected.sentiment;
      sentimentCompared++;
      if (sentimentAgrees) sentimentAgreed++;
      matched.push({
        expectedId: expected.id,
        claimId: a.id,
        key,
        anchorErrorSeconds,
        anchorWithinTolerance,
        expectedSentiment: expected.sentiment,
        observedSentiment,
        sentimentAgrees,
      });
    }
    const missing = [...unmatchedExpected].map((key) => ({
      expectedId: expectedByKey.get(key)!.id,
      key,
    }));
    claimFN += missing.length;

    // Critic precision and recall over every candidate that carries a verdict:
    // "positive" is an accept verdict, truth is membership in the expected set.
    for (const candidate of allClaims(run)) {
      const verdict = candidate.audit?.verdict;
      if (typeof verdict !== "string" || !verdict) continue;
      criticVerdicts++;
      const key = candidate.claim.ticker
        ? claimKey(candidate.claim.ticker, candidate.claim.stance)
        : null;
      const truth = key !== null && expectedByKey.has(key);
      const predicted = verdict === "accept";
      if (predicted && truth) criticTP++;
      else if (predicted && !truth) criticFP++;
      else if (!predicted && truth) criticFN++;
    }

    rows.push({
      caseId: c.id,
      videoId: c.videoId,
      language: c.language,
      split: c.split,
      status: c.status,
      runId: run.id,
      accepted: accepted.length,
      matched,
      unexpected,
      missing,
      grade,
    });
  }

  const verifiedCases = cases.filter((c) => c.status === "verified").length;
  const advisory = verifiedCases < minimumVerifiedCases;
  return {
    version: GOLD_REPORT_VERSION,
    goldSetVersion: GOLD_SET_VERSION,
    checkVersion: CHECK_VERSION,
    advisory,
    verifiedCases,
    minimumVerifiedCases,
    advisoryReason: advisory
      ? `Only ${verifiedCases} of ${minimumVerifiedCases} required verified cases; metrics are advisory, not a gate.`
      : null,
    cases: {
      total: cases.length,
      verified: verifiedCases,
      pending: cases.length - verifiedCases,
      scored: rows.filter((r) => r.runId !== null).length,
      missingRun,
    },
    claims: {
      truePositives: claimTP,
      falsePositives: claimFP,
      falseNegatives: claimFN,
      precision: ratio(claimTP, claimTP + claimFP),
      recall: ratio(claimTP, claimTP + claimFN),
    },
    critic: {
      verdicts: criticVerdicts,
      truePositives: criticTP,
      falsePositives: criticFP,
      falseNegatives: criticFN,
      precision: ratio(criticTP, criticTP + criticFP),
      recall: ratio(criticTP, criticTP + criticFN),
    },
    anchors: {
      toleranceSeconds: tolerance,
      // Verified anchors in the set, those with a matched claim, those with a timestamp, those within tolerance.
      verified: anchorsVerified,
      compared: anchorsCompared,
      measured: anchorsMeasured,
      withinTolerance: anchorsWithin,
      accuracy: ratio(anchorsWithin, anchorsCompared),
      meanAbsoluteErrorSeconds: anchorErrors.length
        ? anchorErrors.reduce((a, b) => a + b, 0) / anchorErrors.length
        : null,
    },
    sentiment: {
      compared: sentimentCompared,
      agreed: sentimentAgreed,
      agreement: ratio(sentimentAgreed, sentimentCompared),
    },
    cost: {
      totalUsd: totalCost,
      acceptedClaims: acceptedTotal,
      perAcceptedClaimUsd: ratio(totalCost, acceptedTotal),
    },
    validity: {
      graded,
      passed: gradePassed,
      failures: validityFailures,
    },
    rows,
  };
}

export type GoldReport = ReturnType<typeof goldReport>;
