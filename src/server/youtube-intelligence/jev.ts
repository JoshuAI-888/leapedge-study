import { z } from "zod";
import { boundedSettled } from "./bounded-parallel.ts";
import { listAttempts, release, reserve, settle } from "./store.ts";
import { readEnv } from "./env.ts";
import {
  FAITHFUL_QUESTIONS,
  FaithfulAnswers,
  JEV_INPUT_USD_PER_TOKEN,
  routeSentence,
  type PreScreenBand,
  type ScreenedSentenceData,
} from "../../features/youtube-intelligence/faithfulness-prescreen.ts";
import type { EvidenceRecordData } from "../../features/youtube-intelligence/research-brief.ts";

/**
 * TypeSafe Jev adapter (System One API). Jev takes a JSON state and typed
 * questions and returns probabilities, not text, so it does not fit the model
 * transport (spec 4.1) and is listed in MAY_FETCH instead. The key is read from
 * TYPESAFE_API_KEY and never logged, stored or returned.
 */
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

const JevResponse = z.object({
  answers: FaithfulAnswers,
  usage: z.object({ input_tokens: z.number().int().min(0).optional() }).optional(),
});

type FetchFn = typeof fetch;
type Sentence = { id: string; text: string; evidenceIds: string[] };

export class JevError extends Error {
  status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "JevError";
    this.status = status;
  }
}

/** The state Jev reads for one sentence: the sentence and the quotes it cites. */
export function sentenceState(sentence: Sentence, evidence: EvidenceRecordData[]) {
  const cited = new Set(sentence.evidenceIds);
  return {
    sentence: sentence.text,
    quotes: evidence
      .filter((e) => cited.has(e.id))
      .flatMap((e) => e.quotes.flatMap((q) => (q.translation ? [q.text, `English translation: ${q.translation}`] : [q.text]))),
  };
}

async function ask(
  body: string,
  apiKey: string,
  fetchFn: FetchFn,
  sleep: (ms: number) => Promise<void>,
) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchFn(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
    });
    const text = await response.text();
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await sleep(300 * 2 ** attempt);
      continue;
    }
    // The body can echo the request; only the status is safe to surface.
    if (!response.ok) throw new JevError(`Jev returned HTTP ${response.status}.`, response.status);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new JevError("Jev response was not valid JSON.", response.status);
    }
    return JevResponse.parse(json);
  }
}

export type ScreenResult = {
  model: string;
  results: ScreenedSentenceData[];
  wallMs: number;
  costUsd: number;
  /** Set when some or all sentences could not be screened; those go to the critic. */
  error: string | null;
};

/**
 * Screens every sentence in parallel under one ledger row for `stage`. A
 * sentence Jev could not answer is routed to the critic ("escalate"), never
 * accepted or rejected, so a failure here can only cost the saving.
 */
export async function screenSentences(input: {
  runId: string;
  stage: string;
  sentences: Sentence[];
  evidence: EvidenceRecordData[];
  model: string;
  band: PreScreenBand;
  perVideoCapUsd?: number;
  concurrency?: number;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ScreenResult> {
  const model = input.model;
  const escalateAll = (error: string): ScreenResult => ({ model, results: [], wallMs: 0, costUsd: 0, error });
  if (!input.sentences.length) return { model, results: [], wallMs: 0, costUsd: 0, error: null };
  const apiKey = readEnv().TYPESAFE_API_KEY;
  if (!apiKey) return escalateAll("TYPESAFE_API_KEY is not set; every sentence went to the critic.");
  const bodies = input.sentences.map((s) =>
    JSON.stringify({ model, state: sentenceState(s, input.evidence), questions: FAITHFUL_QUESTIONS }),
  );
  // A generous hold: bytes/4 as tokens, doubled. Output is free.
  const estimatedTokens = bodies.reduce((n, b) => n + Math.ceil(b.length / 4), 0);
  const amount = Math.max(0.000001, estimatedTokens * 2 * JEV_INPUT_USD_PER_TOKEN);
  const attempt = Math.max(0, ...(await listAttempts(input.runId, input.stage)).map((a) => a.attempt)) + 1;
  let id: string;
  try {
    id = await reserve(input.runId, input.stage, amount, attempt, input.perVideoCapUsd);
  } catch (error) {
    return escalateAll(`Jev pre-screen not started: ${error instanceof Error ? error.message : String(error)}`);
  }
  const fetchFn = input.fetch ?? fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = performance.now();
  const settled = await boundedSettled(input.sentences, input.concurrency ?? 8, async (sentence, index) => {
    const t = performance.now();
    const reply = await ask(bodies[index], apiKey, fetchFn, sleep);
    return {
      id: sentence.id,
      pFaithful: reply.answers.faithful.noul,
      errorType: reply.answers.error_type.choice,
      route: routeSentence(reply.answers, input.band),
      ms: Math.round(performance.now() - t),
      inputTokens: reply.usage?.input_tokens ?? Math.ceil(bodies[index].length / 4),
    } satisfies ScreenedSentenceData;
  });
  const wallMs = Math.round(performance.now() - started);
  const results = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failed = settled.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  const inputTokens = results.reduce((n, r) => n + r.inputTokens, 0);
  const costUsd = inputTokens * JEV_INPUT_USD_PER_TOKEN;
  const firstError = failed[0]?.reason instanceof Error ? failed[0].reason.message : failed.length ? String(failed[0].reason) : null;
  if (!results.length) await release(id, firstError ?? "No Jev answers.");
  else
    await settle(id, costUsd, {
      model,
      provider: "typesafe",
      sentences: input.sentences.length,
      answered: results.length,
      inputTokens,
      seconds: wallMs / 1000,
      reservedUsd: amount,
      rates: { input: JEV_INPUT_USD_PER_TOKEN, output: 0 },
    });
  return {
    model,
    results,
    wallMs,
    costUsd,
    error: failed.length ? `${failed.length} of ${input.sentences.length} sentences not screened (${firstError}); they went to the critic.` : null,
  };
}
