import { GoogleGenAI } from "@google/genai";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { execute, SDK_VERSION } from "./core.ts";
import { reserve, saveArtifact, finish } from "./journal.ts";
import {
  CASES,
  buildCase,
  FOLLOWUP_VERSION,
  type CaseName,
} from "./followup-cases.ts";
const name = process.argv[2] as CaseName;
if (!CASES.includes(name)) throw Error(`Choose one of: ${CASES.join(", ")}`);
const dry = buildCase(name, new AbortController().signal);
// JSON copy removes the nonserializable AbortSignal; reattach only to the live request.
const frozen = JSON.parse(JSON.stringify(dry.request));
delete frozen.config.abortSignal;
const configuration = {
  model: dry.request.model,
  sdk: SDK_VERSION,
  prompt: FOLLOWUP_VERSION,
  input: dry.input,
  case: name,
  hypothesis: dry.hypothesis,
  requestHash: createHash("sha256")
    .update(JSON.stringify(frozen))
    .digest("hex"),
};
if (!process.argv.includes("--execute"))
  console.log(
    JSON.stringify(
      { configuration, effectiveRequest: frozen, proposedReservationNzd: 2.5 },
      null,
      2,
    ),
  );
else {
  const key = process.env.GEMINI_API_KEY,
    yt = process.env.YOUTUBE_API_KEY;
  if (!key || !yt) throw Error("GEMINI_API_KEY and YOUTUBE_API_KEY required");
  const ai = new GoogleGenAI({
    apiKey: key,
    httpOptions: { retryOptions: { attempts: 1 } },
  });
  const model = await ai.models.get({
    model: dry.request.model,
    config: { httpOptions: { timeout: 30000 } },
  });
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.search = new URLSearchParams({
    id: dry.input.videoId,
    part: "contentDetails",
  }).toString();
  const response = await fetch(url, {
    headers: { "X-Goog-Api-Key": yt },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Metadata HTTP ${response.status}`);
  const metadata = await response.json();
  const duration = metadata.items?.[0]?.contentDetails?.duration;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration ?? "");
  if (
    !match ||
    Number(match[1] ?? 0) * 3600 +
      Number(match[2] ?? 0) * 60 +
      Number(match[3] ?? 0) !==
      dry.input.durationSeconds
  )
    throw Error("Frozen corpus duration changed; stop and review");
  const directory = resolve("data/native-google-20260915");
  const attempt = reserve(
    directory,
    createHash("sha256").update(JSON.stringify(configuration)).digest("hex"),
    35,
  );
  console.log(
    JSON.stringify({ attemptId: attempt.id, case: name, status: "submitted" }),
  );
  const result = await execute(dry.input, (r) => {
    const live = structuredClone(frozen);
    live.config.abortSignal = r.config?.abortSignal;
    return ai.models.generateContent(live);
  });
  const artifact = saveArtifact(
    directory,
    attempt,
    {
      ...result,
      configuration,
      effectiveRequest: frozen,
      metadata,
      model,
      recordedAt: new Date().toISOString(),
      costBasis: {
        usdInputPerMillion: 0.75,
        usdOutputIncludingThinkingPerMillion: 3.75,
        rateDate: "2026-09-15",
        reservationNzd: 2.5,
      },
    },
    [key, yt],
  );
  finish(directory, attempt.id, result.assessment.outcome, artifact);
  console.log(
    JSON.stringify({
      attemptId: attempt.id,
      outcome: result.assessment.outcome,
      latencyMs: result.latencyMs,
      estimatedUsd: "estimatedUsd" in result ? result.estimatedUsd : null,
      segments:
        "data" in result.assessment
          ? (result.assessment.data?.segments.length ?? null)
          : null,
    }),
  );
}
