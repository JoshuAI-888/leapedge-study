import { database, iso, json } from "../database.ts";
/**
 * The only door to the `jobs` table. The claim, lease and retry semantics —
 * FOR UPDATE SKIP LOCKED, lease fencing, the concurrency limit — belong to the
 * queue item, and nothing enqueues a row until it lands. What is here is the
 * table's shape and the two reads a health check needs.
 */
export const JOB_KINDS = [
  "analyze",
  "settle",
  "push-renew",
  "batch-poll",
  "reconcile",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export type JobRow = {
  id: string;
  kind: string;
  payload: unknown;
  status: string;
  runAfter: string | null;
  leaseUntil: string | null;
  leaseToken: string | null;
  attempts: number;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
const COLUMNS =
  "id,kind,payload,status,run_after,lease_until,lease_token,attempts,error,created_at,updated_at";
function convert(r: Record<string, unknown>): JobRow {
  return {
    id: String(r.id),
    kind: String(r.kind),
    payload: json(r.payload),
    status: String(r.status),
    runAfter: iso(r.run_after),
    leaseUntil: iso(r.lease_until),
    leaseToken: r.lease_token === null ? null : String(r.lease_token),
    attempts: Number(r.attempts ?? 0),
    error: r.error === null ? null : String(r.error),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
/**
 * Enqueue one job. The id is the caller's idempotency key: a second enqueue of
 * the same work is ignored by the primary key rather than duplicated.
 */
export async function enqueueJob(job: {
  id: string;
  kind: string;
  payload?: unknown;
  runAfter?: string;
}) {
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      "INSERT INTO jobs(id,kind,payload,status,run_after,created_at,updated_at) VALUES($1,$2,$3::jsonb,'queued',$4,$5,$5) ON CONFLICT(id) DO NOTHING",
    )
    .run(job.id, job.kind, JSON.stringify(job.payload ?? {}), job.runAfter ?? now, now);
  return result.changes > 0;
}
export async function listJobs(limit = 100): Promise<JobRow[]> {
  return (
    (await database
      .prepare(
        `SELECT ${COLUMNS} FROM jobs ORDER BY run_after,created_at,id LIMIT $1`,
      )
      .all(limit)) as Record<string, unknown>[]
  ).map(convert);
}
export async function countJobs(status?: string): Promise<number> {
  const r = (
    status
      ? await database
          .prepare("SELECT COUNT(*) AS n FROM jobs WHERE status=$1")
          .get(status)
      : await database.prepare("SELECT COUNT(*) AS n FROM jobs").get()
  ) as { n: unknown };
  return Number(r.n);
}
