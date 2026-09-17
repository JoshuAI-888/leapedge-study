import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ModelRequest,
  ModelResponse,
  TransportError,
  type ModelDescription,
  type ModelRequestData,
  type ModelResponseData,
  type ModelTransport,
} from "./types.ts";
import { fromOpenRouter } from "./openrouter.ts";
/**
 * FakeModelTransport: replays responses without a network or a key.
 *
 * Responses come from an in-memory map keyed by stage (a single reply, a
 * queue that is consumed one call at a time, or a function of the request)
 * or, when the stage has no entry, from a frozen capture at
 * <frozenDir>/<stage>-<hash>.json in the envelope tests/helpers/frozen.ts
 * defines, where hash = requestHash(request). Every request is recorded, and
 * failOn(n, kind) makes the Nth call fail with a 429, 5xx, timeout or
 * unknown error so retry policy can be exercised deterministically.
 */
const STAGE = /^[a-z][a-z0-9-]{0,60}$/;
const HASH = /^[0-9a-f]{16}$/;
export const FrozenEnvelope = z.object({
  stage: z.string().regex(STAGE),
  hash: z.string().regex(HASH),
  model: z.string().min(1),
  capturedAt: z.string(),
  request: z.unknown().optional(),
  response: z.unknown(),
  note: z.string().optional(),
});
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
    );
  return value;
}
/** Same function as tests/helpers/frozen.ts requestHash: 16 hex of SHA-256 over key-sorted JSON. */
export function requestHash(request: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(stable(request)))
    .digest("hex")
    .slice(0, 16);
}
export function defaultFrozenDir() {
  return join(process.cwd(), "tests", "fixtures", "model");
}
function loadFrozen(stage: string, hash: string, dir: string) {
  if (!STAGE.test(stage)) throw Error(`Invalid frozen stage name: ${stage}`);
  const path = join(dir, `${stage}-${hash}.json`);
  if (!existsSync(path))
    throw Error(
      `No frozen response at ${path}. Capture it once with live keys and commit it; see tests/fixtures/model/README.md.`,
    );
  const parsed = FrozenEnvelope.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success)
    throw Error(`Frozen response ${path} is malformed: ${parsed.error.message}`);
  if (parsed.data.stage !== stage || parsed.data.hash !== hash)
    throw Error(
      `Frozen response ${path} is malformed: it names ${parsed.data.stage}-${parsed.data.hash}.`,
    );
  return parsed.data;
}
export type FakeFailure = "429" | "5xx" | "timeout" | "unknown";
/** A shorthand reply: the JSON value the model "returned", plus optional trimmings. */
const JsonReply = z.object({
  json: z.unknown(),
  usage: ModelResponse.shape.usage.partial().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  finishReason: z.string().optional(),
});
export type FakeReply =
  | z.input<typeof JsonReply>
  | ModelResponseData
  | Record<string, unknown>;
export type FakeReplier = FakeReply | ((request: ModelRequestData) => FakeReply | Promise<FakeReply>);
export type FakeOptions = {
  responses?: Record<string, FakeReplier | FakeReplier[]>;
  frozenDir?: string;
  describe?: Partial<ModelDescription>;
};
const DEFAULT_DESCRIPTION: ModelDescription = {
  contextLength: 100000,
  inputRate: 0.000001,
  audioRate: 0.000001,
  outputRate: 0.000001,
  supportedEfforts: ["low", "medium", "high"],
};
export function normaliseReply(reply: FakeReply, model?: string): ModelResponseData {
  if (reply && typeof reply === "object" && "choices" in reply)
    return fromOpenRouter(reply);
  if (reply && typeof reply === "object" && "json" in reply) {
    const r = JsonReply.parse(reply);
    return {
      text: JSON.stringify(r.json),
      usage: {
        inputTokens: r.usage?.inputTokens ?? 0,
        outputTokens: r.usage?.outputTokens ?? 0,
        costUsd: r.usage?.costUsd ?? null,
      },
      model: r.model ?? model ?? "fake",
      provider: r.provider ?? "fake",
      finishReason: r.finishReason ?? "stop",
      raw: reply,
    };
  }
  return ModelResponse.parse(reply);
}
export class FakeModelTransport implements ModelTransport {
  readonly name = "fake";
  readonly family = "fake" as const;
  /** Every request received, in order, including the ones that failed. */
  readonly requests: ModelRequestData[] = [];
  private queues = new Map<string, FakeReplier[]>();
  private fixed = new Map<string, FakeReplier>();
  private failures = new Map<number, FakeFailure>();
  private frozenDir: string;
  private description: ModelDescription;
  constructor(options: FakeOptions = {}) {
    this.frozenDir = options.frozenDir ?? defaultFrozenDir();
    this.description = { ...DEFAULT_DESCRIPTION, ...options.describe };
    for (const [stage, reply] of Object.entries(options.responses ?? {}))
      this.respond(stage, reply);
  }
  /** Register a reply for a stage: an array is consumed one call at a time, anything else answers every call. */
  respond(stage: string, reply: FakeReplier | FakeReplier[]) {
    if (Array.isArray(reply)) {
      this.fixed.delete(stage);
      this.queues.set(stage, [...reply]);
    } else {
      this.queues.delete(stage);
      this.fixed.set(stage, reply);
    }
    return this;
  }
  /** Make the Nth call (1-based, counted over every stage) fail with the given kind. */
  failOn(call: number, kind: FakeFailure) {
    this.failures.set(call, kind);
    return this;
  }
  requestsFor(stage: string) {
    return this.requests.filter((r) => r.stage === stage);
  }
  async describe(_model: string): Promise<ModelDescription> {
    return { ...this.description, supportedEfforts: [...this.description.supportedEfforts] };
  }
  async call(request: ModelRequestData): Promise<ModelResponseData> {
    const r = ModelRequest.parse(request);
    this.requests.push(r);
    const failure = this.failures.get(this.requests.length);
    if (failure) throw failureError(failure);
    const queue = this.queues.get(r.stage);
    let replier: FakeReplier | undefined;
    if (queue) {
      replier = queue.shift();
      if (replier === undefined)
        throw Error(
          `FakeModelTransport: queue exhausted for stage "${r.stage}" on call ${this.requests.length}.`,
        );
    } else if (this.fixed.has(r.stage)) replier = this.fixed.get(r.stage);
    if (replier === undefined) {
      const frozen = loadFrozen(r.stage, requestHash(r), this.frozenDir);
      return normaliseReply(frozen.response as FakeReply, frozen.model);
    }
    const reply = typeof replier === "function" ? await replier(r) : replier;
    return normaliseReply(reply, r.model);
  }
}
function failureError(kind: FakeFailure) {
  switch (kind) {
    case "429":
      return new TransportError("rate_limited", "Provider HTTP 429. No automatic paid retry.", 429);
    case "5xx":
      return new TransportError("server", "Provider HTTP 503. No automatic paid retry.", 503);
    case "timeout":
      return new TransportError("timeout", "Provider request timed out before a response.");
    default:
      return new TransportError("unknown", "Provider request failed for an unknown reason.");
  }
}
