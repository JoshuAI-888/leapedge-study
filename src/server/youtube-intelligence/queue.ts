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
    const backgroundLimit = Math.min(
      capacity,
      z.coerce
        .number()
        .int()
        .min(1)
        .max(64)
        .parse(
          process.env.YTI_BACKGROUND_CONCURRENCY ?? Math.max(1, capacity - 1),
        ),
    );
    const background = await database
      .prepare(
        `SELECT COUNT(*) AS n FROM jobs j JOIN yi_runs r ON r.id=(j.payload::jsonb)->>'runId'
      WHERE j.status='running' AND j.lease_until>$1 AND ((r.input::jsonb)->>'origin'='channel' OR (r.input::jsonb)->>'processingMode'='batch') AND COALESCE((r.input::jsonb)->>'task','')!='research-brief'`,
      )
      .get(now);
    const admitBackground = Number(background?.n ?? 0) < backgroundLimit;
    const row = await database
      .prepare(
        `SELECT ${COLUMNS} FROM jobs WHERE ((status='queued' AND run_after<=$1) OR (status='running' AND lease_until<=$1)) AND kind=ANY($2::text[]) AND ($3::boolean OR NOT EXISTS (
          SELECT 1 FROM yi_runs r WHERE r.id=(jobs.payload::jsonb)->>'runId'
          AND ((r.input::jsonb)->>'origin'='channel' OR (r.input::jsonb)->>'processingMode'='batch')
          AND COALESCE((r.input::jsonb)->>'task','')!='research-brief'
        )) ORDER BY
          CASE WHEN run_after < $1::timestamptz - interval '120 seconds' THEN 0 ELSE 1 END,
          CASE WHEN run_after < $1::timestamptz - interval '120 seconds' THEN run_after END,
          CASE
            WHEN kind='analyze' THEN COALESCE((SELECT CASE
              WHEN (input::jsonb)->>'origin'='manual' THEN 0
              WHEN (input::jsonb)->>'task'='research-brief' THEN 1
              WHEN (input::jsonb)->>'origin' IN ('channel','replay') OR (input::jsonb)->>'processingMode'='batch' THEN 3
              ELSE 2 END FROM yi_runs WHERE id=(jobs.payload::jsonb)->>'runId'),2)
            ELSE 2 END,
          run_after,created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      )
      .get(now, parsed.kinds ?? [...JOB_KINDS], admitBackground);
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
