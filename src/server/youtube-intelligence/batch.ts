import {
  GoogleGenAI,
  type CreateBatchJobParameters,
  GenerateContentResponse,
} from "@google/genai";
import { z } from "zod";
import { createHash } from "node:crypto";
import { doc, docs, put } from "./research-store.ts";
import {
  db,
  reserve,
  settle,
  release,
  markUnknown,
  retainResponse,
  retainedResponse,
  listAttempts,
} from "./store.ts";
import { enqueueJob } from "./repos/jobs.ts";
import { SourcePending } from "./transcripts.ts";
import {
  GoogleNativeTransport,
  usageOf,
  textOf,
} from "./transport/google-native.ts";
import {
  ModelRequest,
  ModelResponse,
  type ModelRequestData,
  type ModelResponseData,
} from "./transport/types.ts";
import type { Run } from "../../features/youtube-intelligence/contracts.ts";
export class BatchPending extends SourcePending {}
export type BatchClient = {
  create: (input: CreateBatchJobParameters) => Promise<unknown>;
  get: (input: { name: string }) => Promise<unknown>;
};
let injected: BatchClient | undefined;
export function injectBatchClient(client: BatchClient) {
  const prior = injected;
  injected = client;
  return () => {
    injected = prior;
  };
}
function client(): BatchClient {
  if (injected) return injected;
  if (!process.env.GEMINI_API_KEY)
    throw Error("GEMINI_API_KEY is not configured.");
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { retryOptions: { attempts: 1 }, timeout: 60000 },
  }).batches;
}
const RecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  stage: z.string(),
  callId: z.string(),
  key: z.string(),
  model: z.string(),
  status: z.enum(["submitting", "pending", "completed", "failed", "uncertain"]),
  name: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  requestFingerprint: z.string(),
});
type BatchRecord = z.infer<typeof RecordSchema>;
const KIND = "google-batch";
const recordId = (runId: string, stage: string, fingerprint: string) =>
  createHash("sha256").update(`${runId}:${stage}:${fingerprint}`).digest("hex");
export async function batchRecord(
  runId: string,
  stage: string,
  fingerprint?: string,
) {
  const row = fingerprint
    ? await doc(KIND, recordId(runId, stage, fingerprint))
    : (await docs(KIND)).find(
        (value) => value.runId === runId && value.stage === stage,
      );
  return row ? RecordSchema.parse(row) : null;
}
async function read(id: string) {
  const row = await doc(KIND, id);
  if (!row) throw Error("Batch request missing.");
  return RecordSchema.parse(row);
}
async function schedule(record: BatchRecord) {
  await enqueueJob({
    id: `batch-poll:${record.id}`,
    kind: "batch-poll",
    payload: { id: record.id },
    runAfter: new Date(Date.now() + 60000).toISOString(),
  });
}
async function result(record: BatchRecord): Promise<ModelResponseData> {
  if (record.status === "completed")
    return ModelResponse.parse(
      await retainedResponse(`${record.callId}:normalized`),
    );
  if (record.status === "failed") throw Error(record.error ?? "Batch failed.");
  if (record.status === "submitting" || record.status === "uncertain")
    throw Error(
      "Batch submission outcome uncertain; reconcile the provider job before retrying.",
    );
  throw new BatchPending(
    "Batch analysis is pending; the worker will poll its durable provider job.",
  );
}
/** Reserve and persist submission intent BEFORE IO. A crash can lose a resource
 * name, but can never authorize a second submission of the same paid request. */
export async function submitBatchStage(
  run: Run,
  input: ModelRequestData,
  amount: number,
  cap: number,
  fingerprint?: string,
): Promise<ModelResponseData> {
  const request = ModelRequest.parse(input);
  const requestFingerprint =
    fingerprint ??
    createHash("sha256").update(JSON.stringify(request)).digest("hex");
  let record = await batchRecord(run.id, request.stage, requestFingerprint);
  if (record) return result(record);
  const sdk = client(); // Validate credentials before reserving.
  const parameters = new GoogleNativeTransport().parameters({
    ...request,
    cachedContent: undefined,
  });
  if (Buffer.byteLength(JSON.stringify(parameters), "utf8") > 19 * 1024 * 1024)
    throw Error("Batch inline request exceeds the 19 MB safety limit.");
  const id = recordId(run.id, request.stage, requestFingerprint);
  record = await db().transaction(async () => {
    const callId = await reserve(run.id, request.stage, amount * 0.5, 1, cap);
    const value: BatchRecord = {
      id,
      runId: run.id,
      stage: request.stage,
      callId,
      key: id,
      model: request.model,
      requestFingerprint,
      status: "submitting",
      createdAt: new Date().toISOString(),
    };
    await settle(callId, null, {
      batch: true,
      requestFingerprint,
      processingMode: "batch",
      model: request.model,
      reservedUsd: amount * 0.5,
    });
    await put(KIND, id, value);
    return value;
  });
  try {
    const {
      httpOptions: _http,
      abortSignal: _abort,
      ...config
    } = parameters.config ?? {};
    const created = z
      .looseObject({ name: z.string().min(1), state: z.string().optional() })
      .parse(
        await sdk.create({
          model: parameters.model,
          src: [
            { contents: parameters.contents, config, metadata: { key: id } },
          ],
          config: { displayName: `yti-${id}` },
        }),
      );
    record = { ...record, name: created.name, status: "pending" };
    await db().transaction(async () => {
      await put(KIND, id, record!);
      await schedule(record!);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = Number((error as { status?: unknown })?.status);
    if ([400, 401, 403, 404, 429].includes(status)) {
      await release(record.callId, `Batch submission rejected: ${status}`);
      await put(KIND, id, {
        ...record,
        status: "failed",
        error: `Batch submission rejected: ${status}`,
      });
      throw Error(`Batch submission rejected: ${status}`);
    }
    await markUnknown(record.callId, "Batch submission outcome uncertain");
    await put(KIND, id, { ...record, status: "uncertain", error: message });
    throw Error(
      "Batch submission outcome uncertain; no automatic resubmission.",
    );
  }
  return result(record);
}
const Output = z.looseObject({
  name: z.string().optional(),
  state: z.string(),
  dest: z
    .looseObject({
      inlinedResponses: z
        .array(
          z.looseObject({
            metadata: z.record(z.string(), z.string()).optional(),
            response: z.unknown().optional(),
            error: z.unknown().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});
/** Polling is read-only at the provider. Match exact request key, never position. */
export async function pollBatch(id: string) {
  const record = await read(id);
  if (record.status === "completed" || record.status === "failed") return;
  if (!record.name)
    throw Error(
      "Batch submission outcome uncertain; missing provider resource name.",
    );
  if (Date.now() - Date.parse(record.createdAt) > 48 * 60 * 60 * 1000) {
    await markUnknown(record.callId, "Batch exceeded 48-hour polling window");
    await put(KIND, id, {
      ...record,
      status: "uncertain",
      error: "Batch exceeded 48-hour polling window",
    });
    throw Error(
      "Batch exceeded 48-hour polling window; operator reconciliation required.",
    );
  }
  let fetched: unknown;
  try {
    fetched = await client().get({ name: record.name });
  } catch {
    throw new BatchPending(
      "Batch status temporarily unavailable; polling will retry.",
    );
  }
  const parsedOutput = Output.safeParse(fetched);
  if (!parsedOutput.success) {
    await uncertain(record, "Batch provider output was malformed");
    throw Error(
      "Batch provider output was malformed; reconciliation required.",
    );
  }
  const raw = parsedOutput.data;
  const matches = (raw.dest?.inlinedResponses ?? []).filter(
    (row) => row.metadata?.key === record.key,
  );
  if (matches.length > 1) {
    await uncertain(record, "Batch output contains duplicate request keys");
    throw Error("Batch output contains duplicate request keys.");
  }
  const match = matches[0];
  if (match?.response) {
    const parsedResponse = z
      .looseObject({
        candidates: z
          .array(
            z.looseObject({
              content: z
                .looseObject({
                  parts: z
                    .array(
                      z.looseObject({
                        text: z.string().optional(),
                        thought: z.boolean().optional(),
                      }),
                    )
                    .optional(),
                })
                .optional(),
              finishReason: z.string().optional(),
            }),
          )
          .optional(),
        usageMetadata: z.looseObject({}).optional(),
        modelVersion: z.string().optional(),
      })
      .parse(match.response);
    const response: GenerateContentResponse = Object.assign(
      new GenerateContentResponse(),
      parsedResponse,
    );
    const usage = usageOf(record.model, response);
    const reported = z
      .looseObject({ usage: z.looseObject({ cost: z.number().nonnegative() }) })
      .safeParse(response);
    const normalized = ModelResponse.parse({
      text: textOf(response),
      usage: {
        ...usage,
        costUsd: reported.success
          ? reported.data.usage.cost
          : usage.costUsd === null
            ? null
            : usage.costUsd * 0.5,
      },
      model: record.model,
      provider: "google-native-batch",
      finishReason: String(
        response.candidates?.[0]?.finishReason,
      ).toLowerCase(),
      raw: response,
    });
    const estimatedHold = (await listAttempts(record.runId, record.stage)).find(
      (row) => row.id === record.callId,
    )?.amount;
    if (normalized.usage.costUsd === null && estimatedHold === undefined)
      throw Error("Batch reservation is missing.");
    await db().transaction(async () => {
      await retainResponse(record.callId, record.runId, record.stage, response);
      await retainResponse(
        `${record.callId}:normalized`,
        record.runId,
        record.stage,
        { ...normalized, requestFingerprint: record.requestFingerprint },
      );
      await settle(record.callId, normalized.usage.costUsd ?? estimatedHold!, {
        batch: true,
        requestFingerprint: record.requestFingerprint,
        costEstimated: normalized.usage.costUsd === null,
        processingMode: "batch",
        providerJob: record.name,
        model: record.model,
        usage: normalized.usage,
        discount: 0.5,
      });
      await put(KIND, id, { ...record, status: "completed" });
    });
    return;
  }
  if (match?.error || raw.state === "JOB_STATE_FAILED") {
    await db().transaction(async () => {
      await release(
        record.callId,
        "Batch request failed without a generated response",
      );
      await put(KIND, id, {
        ...record,
        status: "failed",
        error: "Batch request failed without a generated response",
      });
    });
    return;
  }
  if (
    [
      "JOB_STATE_CANCELLED",
      "JOB_STATE_EXPIRED",
      "JOB_STATE_SUCCEEDED",
    ].includes(raw.state)
  ) {
    // Missing keyed output is not evidence of zero billable work, especially
    // after cancellation. Keep the hold and require operator reconciliation.
    await markUnknown(
      record.callId,
      "Terminal batch omitted the matching response",
    );
    await put(KIND, id, {
      ...record,
      status: "uncertain",
      error: "Terminal batch omitted the matching response",
    });
    throw Error("Batch terminal outcome uncertain: matching response missing.");
  }
  throw new BatchPending("Batch provider job is still running.");
}
export async function schedulePendingBatches() {
  for (const value of await docs(KIND)) {
    const record = RecordSchema.parse(value);
    if (record.status === "pending") await schedule(record);
  }
}

async function uncertain(record: BatchRecord, error: string) {
  await db().transaction(async () => {
    await markUnknown(record.callId, error);
    await put(KIND, record.id, { ...record, status: "uncertain", error });
  });
}
