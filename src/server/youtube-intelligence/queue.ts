import { randomUUID } from "node:crypto";
import { z } from "zod";
import { advisoryKey, database } from "./database.ts";
import { convert, COLUMNS, JOB_KINDS } from "./repos/jobs.ts";
import { teamPreferences } from "./research-store.ts";
export const queuePaused = () =>
  ["true", "1"].includes(process.env.YTI_QUEUE_PAUSED ?? "");
export const QUEUE_LEASE_MS = 600_000;
const CLAIM_LOCK = advisoryKey("yi:queue:capacity");
const ClaimOptions = z.object({
  parallelVideos: z.number().int().min(1).max(64).optional(),
  kinds: z.array(z.enum(JOB_KINDS)).optional(),
});
/** Capacity decision and SKIP LOCKED claim share one short transaction. The
 * advisory lock serializes only admission; no lock is held during provider IO. */
export async function claimJob(options: z.input<typeof ClaimOptions> = {}) {
  if (queuePaused()) return null;
  const parsed = ClaimOptions.parse(options);
  const capacity =
    parsed.parallelVideos ??
    (await teamPreferences()).processing.parallelVideos;
  return database.transaction(async () => {
    await database
      .prepare("SELECT pg_advisory_xact_lock($1::bigint)")
      .get(CLAIM_LOCK);
    const now = new Date().toISOString();
    const count = (await database
      .prepare(
        "SELECT COUNT(*) AS n FROM jobs WHERE status='running' AND lease_until>$1",
      )
      .get(now)) as { n: unknown };
    if (Number(count.n) >= capacity || queuePaused()) return null;
    const row = await database
      .prepare(
        `SELECT ${COLUMNS} FROM jobs WHERE ((status='queued' AND run_after<=$1) OR (status='running' AND lease_until<=$1)) AND kind=ANY($2::text[]) ORDER BY run_after,created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      )
      .get(now, parsed.kinds ?? [...JOB_KINDS]);
    if (!row) return null;
    const claimed = await database
      .prepare(
        `UPDATE jobs SET status='running',lease_until=$1,lease_token=$2,attempts=attempts+1,updated_at=$3 WHERE id=$4 RETURNING ${COLUMNS}`,
      )
      .get(
        new Date(Date.now() + QUEUE_LEASE_MS).toISOString(),
        randomUUID(),
        now,
        row.id,
      );
    return convert(claimed!);
  });
}
export async function renewJob(id: string, token: string) {
  return (
    (
      await database
        .prepare(
          "UPDATE jobs SET lease_until=$1,updated_at=$2 WHERE id=$3 AND lease_token=$4 AND status='running' AND lease_until>$2",
        )
        .run(
          new Date(Date.now() + QUEUE_LEASE_MS).toISOString(),
          new Date().toISOString(),
          id,
          token,
        )
    ).changes > 0
  );
}
export async function completeJob(id: string, token: string) {
  return finish(id, token, "completed", null, 0);
}
export async function retryJob(
  id: string,
  token: string,
  error: string | null,
  delayMs = 1500,
) {
  return finish(id, token, "queued", error, delayMs);
}
export async function failJob(id: string, token: string, error: string) {
  return finish(id, token, "failed", error, 0);
}
async function finish(
  id: string,
  token: string,
  status: string,
  error: string | null,
  delayMs: number,
) {
  const now = new Date().toISOString();
  return (
    (
      await database
        .prepare(
          "UPDATE jobs SET status=$1,error=$2,run_after=$3,lease_until=NULL,lease_token=NULL,updated_at=$4 WHERE id=$5 AND lease_token=$6 AND status='running' AND lease_until>$4",
        )
        .run(
          status,
          error,
          new Date(Date.now() + delayMs).toISOString(),
          now,
          id,
          token,
        )
    ).changes > 0
  );
}
