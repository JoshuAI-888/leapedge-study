// Offline, no provider calls. Run from repository root with --experimental-strip-types.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createHash } from "node:crypto";
const directory = resolve(process.argv[2] ?? "data/native-google-20260915");
const ledger = JSON.parse(readFileSync(`${directory}/ledger.json`, "utf8"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const attempts = ledger.map((a) => {
  if (!a.artifact)
    return {
      attemptId: a.id,
      at: a.createdAt,
      outcome: a.status,
      reservedNzd: a.reservedNzd,
      terminal: false,
    };
  const bytes = readFileSync(`${directory}/${basename(a.artifact)}`);
  const x = JSON.parse(bytes);
  const data = x.assessment?.data;
  const text = data?.segments?.map((s) => s.text).join("") ?? null;
  const raw = (x.response?.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
  const input = x.configuration?.input;
  const expectedRequest = x.effectiveRequest
    ? structuredClone(x.effectiveRequest)
    : null;
  if (expectedRequest?.config) delete expectedRequest.config.abortSignal;
  const usage = x.response?.usageMetadata ?? null;
  const rates = x.configuration?.budget?.rates ?? { input: 0.75, output: 3.75 };
  const observedComponentEstimateUsd =
    usage &&
    typeof usage.promptTokenCount === "number" &&
    typeof usage.candidatesTokenCount === "number"
      ? (usage.promptTokenCount * rates.input +
          usage.candidatesTokenCount * rates.output) /
        1e6
      : null;
  return {
    attemptId: a.id,
    retryOf: a.retryOf ?? null,
    at: a.createdAt,
    terminal: true,
    videoId: input?.videoId ?? null,
    configuration: x.configuration,
    outcome:
      x.configuration?.diagnostic === "minimal-file-uri.v1" && raw
        ? "diagnostic_text_received"
        : x.assessment.outcome,
    validationOutcome: x.assessment.outcome,
    httpStatus: x.assessment.httpStatus ?? null,
    latencyMs: x.latencyMs,
    estimatedUsd: x.estimatedUsd ?? null,
    observedComponentEstimateUsd,
    observedComponentEstimateNote:
      "Recorded-rate arithmetic on observed prompt and candidate tokens only; excludes missing thoughts and discounts; not invoice.",
    usage,
    billing: x.billing ?? "unreconciled",
    reservedNzd: a.reservedNzd,
    segments: data?.segments?.length ?? null,
    textCharacters: text?.replace(/\s/g, "").length ?? null,
    language: data?.language ?? null,
    firstStart: data?.segments?.[0]?.start_seconds ?? null,
    lastEnd: data?.segments?.at(-1)?.end_seconds ?? null,
    coverageFraction: x.assessment.coverageFraction ?? null,
    warnings: x.assessment.warnings ?? [],
    invalidSegments:
      data?.segments
        ?.filter(
          (s) =>
            s.start_seconds > s.end_seconds ||
            s.start_seconds < input.startSeconds ||
            s.end_seconds > input.endSeconds,
        )
        .map((s) => ({
          startSeconds: s.start_seconds,
          endSeconds: s.end_seconds,
        })) ?? [],
    modelReportedOmissions: data?.model_reported_omissions ?? [],
    audioVerified: false,
    timestampAlignmentVerified: false,
    sourceHash: text ? sha(text.replace(/\s/g, "")) : null,
    rawArtifactSha256: sha(bytes),
    requestHash: expectedRequest ? sha(JSON.stringify(expectedRequest)) : null,
    error: x.error?.message ?? null,
  };
});
const shadows = [];
for (const name of [
  "alpha-v5-shadow.json",
  "alpha-v5-single-segment-shadow.json",
]) {
  const shadowPath = `${directory}/${name}`;
  if (!existsSync(shadowPath)) continue;
  const s = JSON.parse(readFileSync(shadowPath));
  shadows.push({
    id: s.id,
    status: s.status,
    sourceAttempt: s.sourceAttempt,
    sourceHash: s.sourceHash,
    promptHash: s.promptHash,
    promptVersion: s.promptVersion,
    synthesisModel: s.synthesisModel,
    criticModel: s.criticModel,
    transport: s.transport,
    canonicalPromotion: false,
    audioVerified: false,
    attempts: s.attempts,
    error: s.error ?? null,
    items:
      s.items?.map((i) => ({
        id: i.id,
        kind: i.kind,
        thesisEnglish: i.claim.thesis_en,
        ticker: i.claim.ticker,
        instrumentAsSpoken: i.claim.instrument_as_spoken,
        stance: i.claim.stance,
        levels: i.claim.levels,
        evidenceSegments: i.claim.evidence.map((e) => e.segment_id),
        structuralReasons: i.structuralReasons,
        audit: i.audit,
        textAccepted: i.textAccepted,
      })) ?? [],
  });
}
const shadowReport = {
  id: "native-google-shadow-comparison-20260915",
  at: new Date().toISOString(),
  shadows,
  textReview: [
    {
      candidateId: "native-google-alpha-v5-single-segment-shadow-20260915",
      itemId: "item-7",
      finding:
        "Draft adds a closes-below condition; retained source describes breaking below. The model critic accepted it without flagging the added bar-close condition.",
      reviewType: "assistant_review_against_retained_text",
      audioVerified: false,
      status: "requires_semantic_review",
    },
    {
      candidateId: "native-google-alpha-v5-single-segment-shadow-20260915",
      itemId: "item-1",
      finding:
        "SPY claim rejected because the quoted evidence omitted the explicit ticker occurrence. No automatic symbol repair.",
      reviewType: "deterministic_validation",
      audioVerified: false,
      status: "rejected",
    },
    {
      candidateId: "native-google-alpha-v5-single-segment-shadow-20260915",
      finding:
        "Separate QQQ/IWM holding guidance from baseline is absent as a separate candidate claim. Counts do not establish recall parity.",
      reviewType: "draft_to_draft_comparison",
      audioVerified: false,
      status: "requires_recall_review",
    },
  ],
  conclusion:
    "Single-segment guidance reduces quote-boundary failures on one development source. Candidate not promoted; critic acceptance is not final verified accuracy.",
};
if (shadows.length)
  writeFileSync(
    "docs/native-google-shadow-results.json",
    JSON.stringify(shadowReport, null, 2) + "\n",
  );
const report = {
  id: "native-google-feasibility-20260915",
  at: new Date().toISOString(),
  status: attempts.every((a) => a.terminal)
    ? "completed_recorded_attempts"
    : "live_evaluation",
  hypothesis:
    "Native Google-only ingestion can replace external transcript providers.",
  attempts,
  estimatedKnownUsd: attempts.reduce((n, a) => n + (a.estimatedUsd ?? 0), 0),
  unknownCostAttempts: attempts.filter((a) => a.estimatedUsd === null).length,
  reservedNzd: Number(ledger.reduce((n, a) => n + a.reservedNzd, 0).toFixed(2)),
  campaignCapNzd: 50,
  requestCap: 60,
  shadowId: shadows.length ? shadowReport.id : null,
  limitations: [
    "No independent audio reference was scored.",
    "Model-to-model or caption agreement is not ground truth.",
    "Static interval coverage does not measure semantic recall.",
    "Unknown billing and timed-out requests remain reserved; estimates are not invoices.",
    "Historical and follow-up configurations differ, so pooled success percentages are not reliability estimates.",
    "Old diagnostics use their saved effective request when available; configuration hashes alone cannot reconstruct every historical request.",
  ],
};
writeFileSync(
  "docs/native-google-live-results.json",
  JSON.stringify(report, null, 2) + "\n",
);
const scripts = [
  "core.ts",
  "runner.ts",
  "journal.ts",
  "followup.ts",
  "followup-cases.ts",
  "shadow-synthesis.ts",
  "text-budget.ts",
  "shadow-prompts.ts",
  "report.mjs",
  "compare.mjs",
  "snapshot-sources.py",
  "whitepaper-appendix.mjs",
  "package.json",
  "package-lock.json",
  "fixtures/rejected-schema-request.json",
];
writeFileSync(
  "docs/native-google-script-manifest.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      files: scripts
        .filter((p) => existsSync(`evaluations/native-google/${p}`))
        .map((p) => ({
          path: `evaluations/native-google/${p}`,
          sha256: sha(readFileSync(`evaluations/native-google/${p}`)),
        })),
      auxiliaryFiles: [
        "scripts/save-native-google-research.ts",
        "evaluations/transcript-accuracy.ts",
      ].map((path) => ({ path, sha256: sha(readFileSync(path)) })),
      historicalScripts: [
        "minimal.ts",
        "schema.ts",
        "google-schema.ts",
        "report.ts",
        "save.ts",
      ]
        .filter((p) => existsSync(`work/native-google/${p}`))
        .map((p) => ({
          privatePath: `work/native-google/${p}`,
          sha256: sha(readFileSync(`work/native-google/${p}`)),
          caution:
            "Hash at report time. Historical helpers depended on a then-current core.ts; saved effectiveRequest is authoritative.",
        })),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    attempts: attempts.length,
    pending: attempts.filter((a) => !a.terminal).length,
    knownEstimatedUsd: report.estimatedKnownUsd,
    reservedNzd: report.reservedNzd,
    shadowRuns: shadows.length,
  }),
);
