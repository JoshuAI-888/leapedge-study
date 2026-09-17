import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { z } from "zod";
/**
 * Frozen model responses: real provider output captured once by a human with
 * live keys and committed under tests/fixtures/model/<stage>-<hash>.json.
 * Tests replay them through a fake transport, so the suite needs no API key.
 * See tests/fixtures/model/README.md for how a file is captured.
 */
export const FROZEN_DIR = fileURLToPath(new URL("../fixtures/model/", import.meta.url));
const STAGE = /^[a-z][a-z0-9-]{0,60}$/;
const HASH = /^[0-9a-f]{16}$/;
export const FrozenResponse = z.object({
  stage: z.string().regex(STAGE),
  hash: z.string().regex(HASH),
  model: z.string().min(1),
  capturedAt: z.string().datetime(),
  request: z.unknown().optional(),
  response: z.unknown(),
  note: z.string().optional(),
});
export type FrozenResponseData = z.infer<typeof FrozenResponse>;
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
/** Sixteen hex characters of SHA-256 over the request with keys sorted, so the same request always names the same file. */
export function requestHash(request: unknown) {
  return createHash("sha256").update(JSON.stringify(stable(request))).digest("hex").slice(0, 16);
}
export function frozenPath(stage: string, hash: string, dir = FROZEN_DIR) {
  if (!STAGE.test(stage)) throw Error(`Invalid frozen stage name: ${stage}`);
  if (!HASH.test(hash)) throw Error(`Invalid frozen request hash: ${hash}`);
  return join(dir, `${stage}-${hash}.json`);
}
export function hasFrozen(stage: string, hash: string, dir = FROZEN_DIR) {
  return existsSync(frozenPath(stage, hash, dir));
}
export function loadFrozen(stage: string, hash: string, dir = FROZEN_DIR): FrozenResponseData {
  const path = frozenPath(stage, hash, dir);
  if (!existsSync(path))
    throw Error(
      `No frozen response at ${path}. Capture it once with live keys and commit it; see tests/fixtures/model/README.md.`,
    );
  const parsed = FrozenResponse.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success)
    throw Error(`Frozen response ${path} is malformed: ${parsed.error.message}`);
  if (parsed.data.stage !== stage || parsed.data.hash !== hash)
    throw Error(
      `Frozen response ${path} does not match its file name (${parsed.data.stage}-${parsed.data.hash}).`,
    );
  return parsed.data;
}
