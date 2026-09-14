import { GoogleGenAI } from "@google/genai";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  Input,
  MODEL,
  SDK_VERSION,
  PROMPT_VERSION,
  execute,
  createTransport,
} from "./core.ts";
import { reserve, saveArtifact, finish } from "./journal.ts";
const choices = {
  alpha: "CMjt6f4eVdA",
  macro: "J25UuUqHT3Y",
  english: "SHMPiWbbR6E",
  offset: "SHMPiWbbR6E",
} as const;
const name = process.argv[2] as keyof typeof choices;
if (!choices[name])
  throw Error("Choose alpha, macro, english or offset. No automatic batch.");
const key = process.env.GEMINI_API_KEY;
const yt = process.env.YOUTUBE_API_KEY;
if (!key || !yt) {
  console.log(
    JSON.stringify({
      outcome: "not_started_missing_credentials",
      geminiConfigured: !!key,
      youtubeConfigured: !!yt,
    }),
  );
  process.exitCode = 2;
} else {
  const directory = resolve("data/native-google-20260915");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    const ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: { retryOptions: { attempts: 1 }, timeout: 30000 },
    });
    const model = await ai.models.get({ model: MODEL });
    // Public metadata via existing YouTube key. Header avoids placing credentials in request URLs.
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.search = new URLSearchParams({
      part: "contentDetails,snippet",
      id: choices[name],
    }).toString();
    const r = await fetch(url, {
      headers: { "X-Goog-Api-Key": yt },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw Error(`YouTube metadata HTTP ${r.status}`);
    const metadata = await r.json();
    const video = metadata.items?.[0];
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(
      video?.contentDetails?.duration ?? "",
    );
    if (!m) throw Error("Missing independent duration");
    const duration =
      Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
    const input = Input.parse({
      videoId: choices[name],
      durationSeconds: duration,
      startSeconds: name === "offset" ? 60 : 0,
      endSeconds: name === "offset" ? 120 : duration,
      mode: "STATIC",
    });
    const configuration = {
      model: MODEL,
      sdk: SDK_VERSION,
      prompt: PROMPT_VERSION,
      input,
      maxOutputTokens: 32768,
      thinkingBudget: 4096,
      mediaResolution: "LOW",
      fps: 1,
    };
    const caseKey = createHash("sha256")
      .update(JSON.stringify(configuration))
      .digest("hex");
    if (!process.argv.includes("--execute")) {
      console.log(
        JSON.stringify({
          outcome: "preflight_only",
          configuration,
          modelInputLimit: model.inputTokenLimit,
          modelOutputLimit: model.outputTokenLimit,
          proposedReservationNzd: 2.5,
        }),
      );
    } else {
      const attempt = reserve(directory, caseKey, 10);
      console.log(
        JSON.stringify({
          attemptId: attempt.id,
          case: name,
          status: "submitted",
          reservedNzd: attempt.reservedNzd,
        }),
      );
      const result = await execute(input, createTransport(key));
      const artifact = saveArtifact(
        directory,
        attempt,
        {
          ...result,
          configuration,
          metadata,
          model,
          recordedAt: new Date().toISOString(),
          costBasis: {
            usdInputPerMillion: 0.75,
            usdOutputIncludingThinkingPerMillion: 3.75,
            rateDate: "2026-09-15",
            reservationNzd: 2.5,
            notes:
              "Reservation retained until reconciliation; estimate is not invoice. No cache discount assumed.",
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
              ? result.assessment.data?.segments.length
              : null,
          artifact,
        }),
      );
    }
  } catch (e) {
    const message = (e instanceof Error ? e.message : "Unknown error")
      .replaceAll(key, "[REDACTED]")
      .replaceAll(yt, "[REDACTED]");
    writeFileSync(
      resolve(directory, `preflight-or-journal-error-${Date.now()}.json`),
      JSON.stringify({ message }),
      { flag: "wx", mode: 0o600 },
    );
    console.error(
      JSON.stringify({ outcome: "stopped_review_required", message }),
    );
    process.exitCode = 1;
  }
}
