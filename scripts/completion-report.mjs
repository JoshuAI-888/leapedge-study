import fs from "node:fs";
import { createHash } from "node:crypto";
const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const root = "data/native-google-20260915";
const outcomes = ["alpha", "mandarin", "long"].map((name) => {
  const r = load(`${root}/${name}-v7-fidelity-shadow.json`);
  return {
    case: name,
    status: r.status,
    sourceAttempt: r.sourceAttempt,
    sourceHash: r.sourceHash,
    promptHash: r.promptHash,
    promptVersion: r.promptVersion,
    attemptIds: r.attempts,
    drafts: r.items.length,
    textAccepted: r.items.filter((x) => x.textAccepted).length,
    structuralFailures: r.items
      .filter((x) => x.structuralReasons.length)
      .map((x) => ({ id: x.id, reasons: x.structuralReasons })),
    error: r.error ?? null,
    audioVerified: false,
  };
});
const ids = new Set(outcomes.flatMap((x) => x.attemptIds));
const ledger = load(`${root}/ledger.json`);
const attempts = ledger
  .filter((x) => ids.has(x.id))
  .map((x) => ({
    id: x.id,
    status: x.status,
    reservedNzd: x.reservedNzd,
    artifactSha256: x.artifact
      ? createHash("sha256").update(fs.readFileSync(x.artifact)).digest("hex")
      : null,
  }));
const files = [
  "src/server/youtube-intelligence/native-google.ts",
  "src/server/youtube-intelligence/native-google-core.ts",
  "src/features/youtube-intelligence/evidence-boundaries.ts",
  "evaluations/native-google/fidelity-prompts.ts",
  "evaluations/native-google/fidelity-synthesis.ts",
  "evaluations/native-google/boundary-replay.ts",
  "scripts/completion-cohort.ts",
  "scripts/completion-hosted-check.ts",
  "scripts/configure-delivery-webhook.mjs",
  "scripts/completion-report.mjs",
  "tests/native-google.test.ts",
  "tests/evidence-boundaries.test.ts",
  "src/server/youtube-intelligence/email.ts",
  "src/server/youtube-intelligence/webhooks.ts",
  "tests/email-reconciliation.test.ts",
  "scripts/completion-live-events.ts",
  "scripts/completion-final-status.ts",
  "scripts/save-completion-research.ts",
];
const report = {
  id: "completion-campaign-20260915",
  at: new Date().toISOString(),
  outcomes,
  attempts,
  accounting: {
    newAttempts: attempts.length,
    newReservationsNzd:
      Math.round(attempts.reduce((n, x) => n + x.reservedNzd, 0) * 100) / 100,
    totalCampaignAttempts: ledger.length,
    totalHeldNzd:
      Math.round(ledger.reduce((n, x) => n + x.reservedNzd, 0) * 100) / 100,
    capNzd: 50,
    costsNotReconciled: true,
  },
  hostedChecks: load("docs/completion-hosted-results-20260915.json"),
  cohort: load("docs/completion-cohort-20260915.json"),
  boundaryReplay: load("docs/completion-boundary-replay-20260915.json"),
  liveEmailEvents: load("docs/completion-live-events-20260915.json"),
  webhookSetup: load("docs/completion-webhook-setup-20260915.json"),
  independentAudioWindowsScored: 0,
  leapedgeCreditsUsedThisCampaign: 0,
  leapedgeComparison: {videoId: "J25UuUqHT3Y", status: "READY", tradeIdeas: 0, keyPoints: 11, tokensDisplayed: "195.4k", prompt: "keypoints.v1-insights.v3-critique.v1", models: ["gemini-3.1-flash-lite", "gemini-3.7-flash", "gemini-3.1-flash-lite"], creditsBefore: 19, creditsAfter: 19, freshIngestionProven: false, audioAccuracyVerified: false},
  finalHostedStatus: load("docs/completion-final-hosted-status-20260915.json"),
  ci: {commit: "919c530a612efada1f17be4cb2e4a50bc1930a23", runs: [34898044303,34898040967], conclusion: "success"},
  promotion: false,
  scriptManifest: files.map((path) => ({
    path,
    sha256: createHash("sha256").update(fs.readFileSync(path)).digest("hex"),
  })),
  sources: [
    {
      url: "https://ai.google.dev/gemini-api/docs/structured-output",
      finding:
        "Schema conformance does not establish semantic accuracy; retain evidence checks.",
    },
    {
      url: "https://ai.google.dev/gemini-api/docs/generate-content/video-understanding",
      finding:
        "Native structured media and clipping documented; completeness/timestamp accuracy require measurements.",
    },
    {
      url: "https://github.com/googleapis/js-genai/issues/938",
      finding:
        "Similar Node fetch-failed report on an older SDK; not proof of our transport failure cause.",
    },
    {
      url: "https://resend.com/docs/webhooks/event-types",
      finding:
        "Delivered means recipient mail server accepted; not inbox placement.",
    },
    {
      url: "https://resend.com/docs/dashboard/emails/introduction",
      finding:
        "Dashboard status provides delivery evidence independently of send response.",
    },
  ],
};
fs.writeFileSync(
  "docs/completion-results-20260915.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    cases: outcomes.map((x) => ({
      case: x.case,
      status: x.status,
      accepted: x.textAccepted,
      drafts: x.drafts,
    })),
    accounting: report.accounting,
  }),
);
