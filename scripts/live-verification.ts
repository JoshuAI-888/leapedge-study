/** Bounded, standalone-only live check. Default is a dry plan, never paid work.
 * --metadata resolves model/video availability only. --execute additionally
 * requires --build-report; caption credits use a conservative US$0.02 allocation.
 * All credentials are selected from --keys (default ../youtube-intelligence/.env).
 * Runtime DB must be an already-migrated isolated localhost /yti_live database. */
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { codeSnapshotHash } from "./standalone-build.ts";
import { teamDefaults } from "../src/features/youtube-intelligence/settings.ts";
import {
  normaliseModel,
  describeFromPrices,
  isPriced,
  priceTableVersion,
} from "../src/server/youtube-intelligence/transport/prices.ts";
export function liveSpendPlan(
  creditUsd: number,
  creditCap = 3,
  alreadyExternalUsd = 0,
) {
  if (
    !Number.isFinite(creditUsd) ||
    creditUsd <= 0 ||
    !Number.isInteger(creditCap) ||
    creditCap < 1 ||
    creditCap > 10 ||
    !Number.isFinite(alreadyExternalUsd) ||
    alreadyExternalUsd < 0
  )
    throw Error("Invalid credit valuation or external spend.");
  const captionHoldUsd = creditUsd * creditCap;
  const modelCapUsd = 25 - captionHoldUsd - alreadyExternalUsd;
  if (modelCapUsd <= 0) throw Error("No remaining task API allowance.");
  return {
    taskCapUsd: 25,
    creditCap,
    creditUsd,
    captionHoldUsd,
    alreadyExternalUsd,
    modelCapUsd,
  };
}
function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function duration(value: string) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  return m
    ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
    : Infinity;
}
const CAPTION_SOURCE =
  "https://transcriptapi.com/docs/api/#credit-usage--billing";
export async function main() {
  const execute = process.argv.includes("--execute"),
    metadata = execute || process.argv.includes("--metadata");
  const settings = teamDefaults();
  settings.models.extraction.id =
    argument("--extraction-model") ?? settings.models.extraction.id;
  settings.models.critique.id =
    argument("--critic-model") ?? settings.models.critique.id;
  const candidates = z
    .object({
      candidates: z.array(
        z.object({ videoId: z.string().regex(/^[\w-]{11}$/) }),
      ),
    })
    .parse(
      JSON.parse(
        readFileSync("docs/delivery/comparison-video-candidates.json", "utf8"),
      ),
    );
  if (!metadata) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-plan",
          paidCalls: 0,
          maximumTaskApiUsd: 25,
          maximumLeapEdgeAnalyses: 20,
          candidates: candidates.candidates.map((x) => x.videoId),
          models: settings.models,
          requirements: [
            "isolated localhost /yti_live database migrated",
            "passing full build report",
            "caption credits conservatively allocated US$0.02 each; no topups",
            "all prior task external spend declared via --external-spend-usd",
            "model/video metadata preflight",
          ],
        },
        null,
        2,
      ),
    );
    return;
  }
  const secrets = parseEnv(
    readFileSync(argument("--keys") ?? "../youtube-intelligence/.env", "utf8"),
  );
  const allowed = [
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "YOUTUBE_API_KEY",
    "TRANSCRIPTAPI_API_KEY",
  ] as const;
  for (const key of allowed) {
    if (!secrets[key]) throw Error(`${key} is unavailable.`);
    process.env[key] = secrets[key];
  }
  for (const key of [
    "SUPADATA_API_KEY",
    "FMP_API_KEY",
    "EXA_API_KEY",
    "RESEND_API_KEY",
    "YTI_PUSH_CALLBACK_SECRET",
  ])
    delete process.env[key];
  const dir = resolve("data/live-verification");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const routerResponse = await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(30000),
  });
  if (!routerResponse.ok)
    throw Error(`OpenRouter metadata HTTP ${routerResponse.status}`);
  const catalogue = z
    .object({
      data: z.array(
        z.looseObject({
          id: z.string(),
          pricing: z.record(z.string(), z.unknown()),
        }),
      ),
    })
    .parse(await routerResponse.json());
  const critic = catalogue.data.find(
    (model) => model.id === settings.models.critique.id,
  );
  const native = [];
  for (const model of [
    ...new Set([settings.models.extraction.id, settings.models.translation.id]),
  ]) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normaliseModel(model))}`,
      {
        headers: { "X-Goog-Api-Key": process.env.GEMINI_API_KEY! },
        signal: AbortSignal.timeout(30000),
      },
    );
    native.push({
      model,
      available: response.ok,
      http: response.status,
      priced: isPriced(model),
      cachedRates: describeFromPrices(model),
      priceTableVersion,
    });
  }
  const videoResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: "snippet,contentDetails", id: candidates.candidates.map((x) => x.videoId).join(",") })}`,
    {
      headers: { "X-Goog-Api-Key": process.env.YOUTUBE_API_KEY! },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!videoResponse.ok)
    throw Error(`YouTube metadata HTTP ${videoResponse.status}`);
  const videos = z
    .object({
      items: z.array(
        z.object({
          id: z.string(),
          snippet: z.object({
            title: z.string(),
            defaultAudioLanguage: z.string().optional(),
          }),
          contentDetails: z.object({
            duration: z.string(),
            caption: z.string().optional(),
          }),
        }),
      ),
    })
    .parse(await videoResponse.json()).items;
  const eligible = videos
    .filter(
      (video) =>
        duration(video.contentDetails.duration) > 180 &&
        duration(video.contentDetails.duration) <= 1200,
    )
    .sort(
      (a, b) =>
        Number(/^en/i.test(b.snippet.defaultAudioLanguage ?? "")) -
          Number(/^en/i.test(a.snippet.defaultAudioLanguage ?? "")) ||
        duration(a.contentDetails.duration) -
          duration(b.contentDetails.duration),
    );
  const requested = argument("--video");
  const video = requested
    ? eligible.find((row) => row.id === requested)
    : eligible[0];
  const preflight = {
    at: new Date().toISOString(),
    paidCalls: 0,
    native,
    critic: critic
      ? { model: critic.id, available: true, pricing: critic.pricing }
      : { model: settings.models.critique.id, available: false },
    video: video ?? null,
    eligibleVideos: eligible.map((row) => ({
      id: row.id,
      title: row.snippet.title,
      durationSeconds: duration(row.contentDetails.duration),
    })),
    captionBillingDocumentation: CAPTION_SOURCE,
  };
  writeFileSync(
    resolve(dir, "metadata.json"),
    JSON.stringify(preflight, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(preflight, null, 2));
  if (!execute) return;
  const reportPath = argument("--build-report");
  if (!reportPath)
    throw Error("--build-report is required before paid verification.");
  const report = z
    .object({
      finishedAt: z.iso.datetime(),
      commandChecksPassed: z.literal(true),
      codeSnapshotSha256: z.string().length(64),
      checks: z.array(
        z.object({ id: z.string(), exitCode: z.number().nullable() }),
      ),
    })
    .parse(JSON.parse(readFileSync(reportPath, "utf8")));
  if (report.codeSnapshotSha256 !== codeSnapshotHash())
    throw Error(
      "Source changed since the passing build; verify again before paid calls.",
    );
  if (Date.now() - Date.parse(report.finishedAt) > 2 * 60 * 60 * 1000)
    throw Error(
      "Build evidence is older than two hours; rerun full checks before paid verification.",
    );
  for (const required of ["tests", "pglite-tests", "typecheck", "build"])
    if (
      !report.checks.some(
        (check) => check.id === required && check.exitCode === 0,
      )
    )
      throw Error(`Missing passing ${required} evidence.`);
  if (native.some((row) => !row.available || !row.priced) || !critic || !video)
    throw Error(
      "Models or a bounded candidate are unavailable; do not start paid work.",
    );
  const creditUsd = Number(argument("--caption-usd-per-credit") ?? "0.02");
  const pricingSource = z
    .string()
    .url()
    .parse(argument("--pricing-source") ?? "https://transcriptapi.com/");
  const allowance = liveSpendPlan(
    creditUsd,
    3,
    Number(argument("--external-spend-usd") ?? 0),
  );
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/yti_live" ||
    process.env.YTI_ISOLATED_DB !== "true"
  )
    throw Error("Paid verification requires isolated localhost /yti_live.");
  delete process.env.YTI_DB;
  delete process.env.YTI_PREVIEW_READ_ONLY;
  process.env.YTI_BUDGET_USD = String(allowance.modelCapUsd);
  process.env.YTI_HARD_BUDGET_USD_MONTH = String(allowance.modelCapUsd);
  process.env.YTI_TRANSCRIPT_CREDIT_BUDGET = String(allowance.creditCap);
  process.env.YTI_GENERATED_TRANSCRIPTS = "false";
  process.env.YTI_EMAIL_SEND_ENABLED = "false";
  process.env.YTI_QUEUE_PAUSED = "false";
  settings.processing.parallelVideos = 1;
  settings.processing.maxRetriesPerStage = 0;
  settings.processing.contextCaching = false;
  settings.processing.userSubmitted = "immediate";
  settings.sources.asr = "off";
  settings.sources.standby = "none";
  settings.sources.agenticAudioReview = false;
  settings.sources.tieBreakWithStandby = false;
  settings.context.enabled = false;
  settings.transport.fallbackToOpenRouter = false;
  settings.budget.perVideoMaxUsd = Math.min(5, allowance.modelCapUsd);
  settings.budget.monthlyUsd = allowance.modelCapUsd;
  const { database } =
    await import("../src/server/youtube-intelligence/database.ts");
  const { saveTeamPreferences, queue, docs } =
    await import("../src/server/youtube-intelligence/research-store.ts");
  const { get } = await import("../src/server/youtube-intelligence/store.ts");
  const { processNext } =
    await import("../src/server/youtube-intelligence/runner.ts");
  const { claimLease, put } =
    await import("../src/server/youtube-intelligence/research-store.ts");
  const lock = await claimLease(
    "liveVerification",
    "exclusive",
    Date.now() + 60 * 60 * 1000,
  );
  if (!lock) {
    await database.close();
    throw Error("Another live verification session holds the task lock.");
  }
  const spend = async () => {
    const rows = await database
      .prepare(
        "SELECT status,COALESCE(SUM(amount),0) AS amount FROM yi_calls GROUP BY status",
      )
      .all();
    const modelUsd = rows
      .filter((row) => row.status !== "released")
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const attempts = await docs<{
      provider: string;
      credits: number;
      status: string;
    }>("managedCaptionAttempt");
    const credits = attempts.reduce((sum, row) => sum + row.credits, 0);
    return {
      at: new Date().toISOString(),
      ...allowance,
      pricingSource,
      modelSpentOrHeldUsd: modelUsd,
      captionCredits: credits,
      captionEstimatedUsd: credits * creditUsd,
      totalSpentOrHeldUsd:
        modelUsd + credits * creditUsd + allowance.alreadyExternalUsd,
      captionSpendIsEstimate: true,
      captionPricingBasis:
        "conservative allocation above published rates; not an invoice",
      pricingCheckedAt: "2026-09-19",
      noTopupsPurchased: true,
      modelCostsIncludeUnknownHolds: true,
      providerCreditRows: attempts.map((row) => ({
        provider: row.provider,
        credits: row.credits,
        status: row.status,
      })),
    };
  };
  try {
    const open = await database
      .prepare(
        "SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')",
      )
      .get();
    if (Number(open?.n) > 0)
      throw Error(
        "Live database has pending work; review and resume it explicitly before a new pilot.",
      );
    const before = await spend();
    if (
      before.captionCredits > allowance.creditCap ||
      before.totalSpentOrHeldUsd >= 25
    )
      throw Error("Task spending allowance is already exhausted.");
    await saveTeamPreferences(settings);
    const run = await queue(video.id);
    const started = Date.now();
    while (Date.now() - started < 20 * 60 * 1000) {
      const current = await get(run.id);
      if (!current) throw Error("Pilot run vanished.");
      const accounting = await spend();
      appendFileSync(
        resolve(dir, "spend.jsonl"),
        JSON.stringify({
          runId: run.id,
          stage: current.stage,
          status: current.status,
          ...accounting,
        }) + "\n",
        { mode: 0o600 },
      );
      if (accounting.totalSpentOrHeldUsd >= 25)
        throw Error("Task financial ceiling reached.");
      if (!["queued", "running"].includes(current.status)) {
        writeFileSync(
          resolve(dir, `run-${run.id}.json`),
          JSON.stringify(
            {
              run: current,
              spend: accounting,
              mode: "live-caption-first",
              asr: "not-executed",
              leapedge: "not-executed",
            },
            null,
            2,
          ) + "\n",
          { mode: 0o600 },
        );
        console.log(
          JSON.stringify({
            runId: run.id,
            status: current.status,
            stage: current.stage,
            spend: accounting,
          }),
        );
        return;
      }
      const processed = await processNext();
      if (!processed) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw Error("Pilot time limit reached; retained state remains for review.");
  } finally {
    process.env.YTI_QUEUE_PAUSED = "true";
    await database
      .prepare("UPDATE jobs SET run_after=$1 WHERE status='queued'")
      .run(new Date(Date.now() + 365 * 86400000).toISOString());
    const accounting = await spend();
    appendFileSync(
      resolve(dir, "spend.jsonl"),
      JSON.stringify({ event: "session-stopped", ...accounting }) + "\n",
      { mode: 0o600 },
    );
    await put("liveVerification", "exclusive", { until: 0 });
    await database.close();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Live verification failed.",
    );
    process.exitCode = 1;
  });
