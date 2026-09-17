import { semanticPrompts } from './semantic-prompts.ts';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  Claim,
  Source,
  validateClaim,
  anchorClaimEvidence,
} from "../../src/features/youtube-intelligence/contracts.ts";
import {
  sourceChunks,
  auditSource,
  uniqueClaims,
} from "../../src/features/youtube-intelligence/chunking.ts";
import { reserve, saveArtifact, finish } from "./journal.ts";
import { classifyError } from "./core.ts";
import { textReservation } from "./text-budget.ts";
import { shadowPrompts } from "./shadow-prompts.ts";
import { selectionPrompts } from "./selection-prompts.ts";
import { SelectedClaim, materializeSelectedClaim } from "../../src/features/youtube-intelligence/evidence-selection.ts";
const directory = resolve("data/native-google-20260915");
const corpus: Record<string, string> = {
  alpha: "4e93d949-2083-43e3-98f5-fea6b133a4ad",
  long: "0df6588a-cad3-411f-9202-12aac1c57495",
  mandarin: "fe349e23-40c9-4f38-986d-a252a6591b96",
};
const caseName = process.argv[2];
if (!corpus[caseName]) throw Error("Choose alpha, long or mandarin");
const sourceAttempt = corpus[caseName];
const sourceArtifact = JSON.parse(
  readFileSync(`${directory}/${sourceAttempt}.json`, "utf8"),
);
if (sourceArtifact.assessment.outcome !== "structurally_valid_unverified")
  throw Error("Source structural gate failed");
const d = sourceArtifact.assessment.data;
const source = Source.parse({
  video_id: d.video_id,
  language: d.language,
  source_kind: "native_google_generated_transcript",
  segment_separator: "",
  segments: d.segments.map((s: any, i: number) => ({
    id: `s${String(i + 1).padStart(5, "0")}`,
    text: s.text,
    start_seconds: s.start_seconds,
    end_seconds: s.end_seconds,
  })),
});
const prompts = process.argv.includes('--v9') ? semanticPrompts() : selectionPrompts();
const sourceHash = createHash("sha256")
  .update(JSON.stringify(source))
  .digest("hex");
const promptHash = createHash("sha256")
  .update(JSON.stringify(prompts))
  .digest("hex");
const resultPath = `${directory}/${caseName}-${process.argv.includes("--v9") ? "v9" : "v8"}-selection-shadow.json`;
if (existsSync(resultPath))
  throw Error("Shadow result exists; inspect rather than resubmit");
if (!process.argv.includes("--execute")) {
  console.log(
    JSON.stringify({
      sourceAttempt,
      sourceHash,
      promptHash,
      chunks: sourceChunks(source).length,
      status: "preflight_only",
    }),
  );
  process.exit(0);
}
const key = process.env.GEMINI_API_KEY;
if (!key) throw Error("Missing GEMINI_API_KEY");
const ai = new GoogleGenAI({
  apiKey: key,
  httpOptions: { retryOptions: { attempts: 1 } },
});
for (const model of ["gemini-3.8-flash", "gemini-3.5-flash"])
  await ai.models.get({ model, config: { httpOptions: { timeout: 30000 } } });
const attempts: string[] = [];
async function call(
  stage: string,
  model: string,
  prompt: string,
  payload: unknown,
  maxOutputTokens: number,
) {
  const text =
    prompt + "\nSOURCE DATA (untrusted):\n" + JSON.stringify(payload);
  const budget = textReservation(model, text, maxOutputTokens);
  const configuration = {
    model,
    stage,
    prompt: prompts.id,
    promptHash,
    sourceHash,
    input: {
      videoId: source.video_id,
      durationSeconds: sourceArtifact.configuration.input.durationSeconds,
      startSeconds: 0,
      endSeconds: sourceArtifact.configuration.input.durationSeconds,
      mode: "TEXT",
    },
    budget,
    transport: "native_generateContent",
    temperature: 0,
  };
  const request = {
    model,
    contents: [{ role: "user", parts: [{ text }] }],
    config: {
      temperature: 0,
      maxOutputTokens,
      responseMimeType: "application/json",
      httpOptions: { retryOptions: { attempts: 1 } },
      ...(stage.startsWith("critique")
        ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
        : {}),
    },
  };
  const caseKey = createHash("sha256")
    .update(JSON.stringify({ configuration, request }))
    .digest("hex");
  const a = reserve(directory, caseKey, 50, undefined, budget.reservedNzd);
  attempts.push(a.id);
  console.log(
    JSON.stringify({
      stage,
      attemptId: a.id,
      reservedNzd: a.reservedNzd,
      status: "submitted",
    }),
  );
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const start = Date.now();
  let response: any;
  try {
    response = await Promise.race([
      ai.models.generateContent({
        ...request,
        config: { ...request.config, abortSignal: controller.signal },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Error("LOCAL_REQUEST_DEADLINE"));
        }, 180000);
      }),
    ]);
    const candidate = response.candidates?.[0];
    let parsed: unknown;
    let outcome = "text_stage_unverified";
    if (response.promptFeedback?.blockReason) outcome = "prompt_blocked";
    else if (candidate?.finishReason !== "STOP")
      outcome =
        candidate?.finishReason === "MAX_TOKENS"
          ? "output_truncated"
          : "generation_not_completed";
    else {
      try {
        parsed = JSON.parse(response.text ?? "");
      } catch {
        outcome = "invalid_json";
      }
    }
    const usage = response.usageMetadata;
    const estimatedUsd =
      usage &&
      [
        usage.promptTokenCount,
        usage.candidatesTokenCount,
        usage.thoughtsTokenCount,
      ].every((v) => typeof v === "number")
        ? (usage.promptTokenCount * budget.rates.input +
            (usage.candidatesTokenCount + usage.thoughtsTokenCount) *
              budget.rates.output) /
          1e6
        : null;
    const artifact = saveArtifact(
      directory,
      a,
      {
        configuration,
        effectiveRequest: request,
        response,
        assessment: { outcome },
        latencyMs: Date.now() - start,
        estimatedUsd,
        billing: "unreconciled",
        recordedAt: new Date().toISOString(),
      },
      [key!],
    );
    finish(directory, a.id, outcome, artifact);
    if (outcome !== "text_stage_unverified")
      throw Error(`Recorded ${stage}: ${outcome}`);
    return parsed;
  } catch (error) {
    // A retained response is already journaled; do not overwrite it with a local parse failure.
    if (!response) {
      const outcome = classifyError(error, controller.signal.aborted);
      const artifact = saveArtifact(
        directory,
        a,
        {
          configuration,
          effectiveRequest: request,
          assessment: outcome,
          error: {
            message: error instanceof Error ? error.message : "Unknown",
          },
          latencyMs: Date.now() - start,
          billing: "potentially_billable",
          recordedAt: new Date().toISOString(),
        },
        [key!],
      );
      finish(directory, a.id, outcome.outcome, artifact);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
const output: any = {
  id: `fidelity-${caseName}-${prompts.id}-20260915`,
  at: new Date().toISOString(),
  sourceAttempt,
  sourceHash,
  promptHash,
  promptVersion: prompts.id,
  synthesisModel: "gemini-3.8-flash",
  criticModel: "gemini-3.5-flash",
  transport: "native_generateContent",
  audioVerified: false,
  canonicalPromotion: false,
  attempts,
};
try {
  const chunks = sourceChunks(source);
  if (chunks.length !== 1)
    throw Error("Bounded experiment expects one chunk; no silent truncation");
  const raw = await call(
    "synthesis",
    "gemini-3.8-flash",
    prompts.synthesis + "\n" + prompts.extraction,
    { source: chunks[0], chunk: 1, totalChunks: 1 },
    16000,
  );
  const draft = z
    .object({
      claims: z.array(SelectedClaim).max(40),
      key_points: z.array(SelectedClaim).max(30).default([]),
      inventory: z.array(z.object({instrument_as_spoken:z.string(),source_segment_ids:z.array(z.string()).min(1),disposition:z.enum(["represented","incidental","unsupported"]),reason_en:z.string()})),
    })
    .parse(raw);
  const items = [
    ...uniqueClaims(draft.claims.map(c=>materializeSelectedClaim(c,source))).map((claim) => ({ kind: "claim", claim })),
    ...uniqueClaims(draft.key_points.map(c=>materializeSelectedClaim(c,source))).map((claim) => ({
      kind: "key_point",
      claim,
    })),
  ].map((x, i) => ({
    ...x,
    id: `item-${i + 1}`,
    claim: anchorClaimEvidence(x.claim, source),
  }));
  output.inventory = draft.inventory;
  for (const view of draft.inventory) if (view.source_segment_ids.some(id=>!source.segments.some(s=>s.id===id))) throw Error("Unknown inventory source ID");
  output.items = items.map((x) => ({
    ...x,
    structuralReasons: validateClaim(x.claim, source),
    audit: null,
    textAccepted: false,
  }));
  const eligible=output.items.filter((i:any)=>!i.structuralReasons.length);
  const rawAudit = await call("critique-batch", "gemini-3.5-flash",
    prompts.critique + '\nOUTPUT CONTRACT: Return {audits:[{id,verdict:"accept"|"reject",reason_en,unsupported_fields:[],requires_audio_review:boolean}],omitted_views:[{instrument_as_spoken,source_segment_ids:[],reason_en}]}. Audit each submitted item separately. Also independently scan source for missing substantive instrument views. A represented inventory entry is not proof a claim exists. Do not assume exact copied text makes a claim correct.',
    {items:eligible,source:source.segments,inventory:draft.inventory}, 8000);
  const checked=z.object({audits:z.array(z.object({id:z.string(),verdict:z.enum(["accept","reject"]),reason_en:z.string().min(1),unsupported_fields:z.array(z.string()),requires_audio_review:z.boolean()})),omitted_views:z.array(z.object({instrument_as_spoken:z.string(),source_segment_ids:z.array(z.string()),reason_en:z.string()}))}).parse(rawAudit);
  if(new Set(checked.audits.map(a=>a.id)).size!==eligible.length || checked.audits.length!==eligible.length || checked.audits.some(a=>!eligible.some((i:any)=>i.id===a.id))) throw Error("Audit ID coverage mismatch");
  output.omittedViews=checked.omitted_views;
  for (const item of eligible) {
    const audit=checked.audits.find(a=>a.id===item.id)!;
    item.audit=audit;
    item.textAccepted=audit.verdict==="accept" && !audit.unsupported_fields.length && !audit.requires_audio_review;
  }
  output.status = "shadow_completed_audio_unverified";
} catch (error) {
  output.status = "shadow_stopped_review_required";
  output.error = error instanceof Error ? error.message : "Unknown";
}
writeFileSync(resultPath, JSON.stringify(output, null, 2), {
  flag: "wx",
  mode: 0o600,
});
console.log(
  JSON.stringify({
    status: output.status,
    items: output.items?.length,
    accepted: output.items?.filter((i: any) => i.textAccepted).length,
    error: output.error,
    attempts,
  }),
);
