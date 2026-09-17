import { database } from "./database.ts";
import { randomUUID } from "node:crypto";
import type { Run } from "../../features/youtube-intelligence/contracts.ts";
export function db() {
  return database;
}
function convert(r: Record<string, unknown>): Run {
  return {
    id: String(r.id),
    videoId: String(r.video_id),
    url: String(r.url),
    model: String(r.model),
    promptVersion: String(r.prompt_version),
    title: String(r.title),
    status: String(r.status),
    stage: String(r.stage),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    error: r.error as string | null,
    input: JSON.parse(String(r.input)),
    output: JSON.parse(String(r.output)),
    cost: Number(r.cost),
  };
}
export async function list() {
  return (
    (await (
      await db()
    )
      .prepare("SELECT * FROM yi_runs ORDER BY created_at DESC")
      .all()) as Record<string, unknown>[]
  ).map(convert);
}
export async function get(id: string) {
  const r = (await (
    await db()
  )
    .prepare("SELECT * FROM yi_runs WHERE id=?")
    .get(id)) as Record<string, unknown> | undefined;
  return r ? convert(r) : null;
}
export async function create(
  video: string,
  model: string,
  input: Record<string, unknown>,
  version: string,
) {
  const d = await db();
  return d.transaction(async () => {
    const old = (await d
      .prepare(
        "SELECT id FROM yi_runs WHERE video_id=? AND model=? AND input=? AND prompt_version=? AND status IN ('queued','running')",
      )
      .get(video, model, JSON.stringify(input), version)) as
      | {
          id: string;
        }
      | undefined;
    if (old) {
      return (await get(old.id))!;
    }
    const id = randomUUID(),
      now = new Date().toISOString();
    await d
      .prepare(
        "INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,input,output) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        video,
        `https://www.youtube.com/watch?v=${video}`,
        model,
        version,
        video,
        "queued",
        "metadata",
        now,
        now,
        JSON.stringify(input),
        "{}",
      );
    return (await get(id))!;
  });
}
export async function claimNext() {
  const d = await db();
  return d.transaction(async () => {
    const r = (await d
      .prepare(
        "SELECT * FROM yi_runs WHERE status='queued' OR (status='running' AND lease_until<?) ORDER BY created_at LIMIT 1",
      )
      .get(Date.now())) as Record<string, unknown> | undefined;
    if (!r) {
      return null;
    }
    const token = randomUUID();
    await d
      .prepare(
        "UPDATE yi_runs SET status='running',lease_until=?,lease_token=?,updated_at=? WHERE id=?",
      )
      .run(Date.now() + 600000, token, new Date().toISOString(), String(r.id));
    return { run: (await get(String(r.id)))!, token };
  });
}
export async function save(run: Run, token: string) {
  const result = await (
    await db()
  )
    .prepare(
      "UPDATE yi_runs SET title=?,status=?,stage=?,updated_at=?,error=?,output=?,lease_until=0 WHERE id=? AND lease_token=?",
    )
    .run(
      run.title,
      run.status,
      run.stage,
      new Date().toISOString(),
      run.error,
      JSON.stringify(run.output),
      run.id,
      token,
    );
  if (!result.changes) throw Error("Stale worker lease.");
}
/** An attempt whose outcome is not yet known; it may already have been billed. */
export const OPEN_CALL_STATUSES = ["reserved", "unknown"] as const;
const OPEN = "status IN ('reserved','unknown')";
/** Released reservations hold no money: they count for neither run nor budget. */
const COUNTED = "status<>'released'";
/**
 * Reserve money for one attempt at one stage, keyed by (run_id, stage, attempt).
 * A completed, failed or released attempt no longer blocks the next one; an OPEN
 * attempt does, because a call still running or of unknown outcome may already
 * have been billed. Spec section 4.4.
 */
export async function reserve(
  runId: string,
  stage: string,
  amount: number,
  attempt = 1,
) {
  const d = await db();
  return d.transaction(async () => {
    if (
      await d
        .prepare(
          `SELECT id FROM yi_calls WHERE run_id=? AND stage=? AND ${OPEN}`,
        )
        .get(runId, stage)
    )
      throw Error(
        "Previous provider call for this stage is still open; recovery is uncertain. Review before retrying.",
      );
    const used = Number(
      (
        (await d
          .prepare(
            `SELECT COALESCE(SUM(amount),0) AS total FROM yi_calls WHERE ${COUNTED}`,
          )
          .get()) as {
          total: number;
        }
      ).total,
    );
    const limit = Number(process.env.YTI_BUDGET_USD || "2");
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isFinite(limit) ||
      used + amount > limit
    )
      throw Error("Local experiment budget limit reached.");
    const id = randomUUID();
    await d
      .prepare(
        "INSERT INTO yi_calls(id,run_id,stage,status,amount,metrics,attempt) VALUES(?,?,?,?,?,?,?)",
      )
      .run(id, runId, stage, "reserved", amount, "{}", attempt);
    await recomputeCost(runId);
    return id;
  });
}
/** A run's cost is the sum of the rows that still hold or have spent money. */
async function recomputeCost(runId: string) {
  const d = await db();
  await d
    .prepare(
      `UPDATE yi_runs SET cost=(SELECT COALESCE(SUM(amount),0) FROM yi_calls WHERE run_id=? AND ${COUNTED}) WHERE id=?`,
    )
    .run(runId, runId);
}
export async function settle(
  id: string,
  amount: number | null,
  metrics: unknown,
) {
  await (
    await db()
  )
    .prepare(
      "UPDATE yi_calls SET status=?,amount=COALESCE(?,amount),metrics=? WHERE id=?",
    )
    .run(
      amount === null ? "reserved" : "completed",
      amount,
      JSON.stringify(metrics),
      id,
    );
  await (
    await db()
  ).exec(
    `UPDATE yi_runs SET cost=(SELECT COALESCE(SUM(amount),0) FROM yi_calls WHERE run_id=yi_runs.id AND ${COUNTED})`,
  );
}
/**
 * Give a reservation back: the attempt is closed, holds no money, and a further
 * attempt at that stage may be reserved. The reason is kept beside whatever
 * metrics the attempt had already recorded.
 */
export async function release(id: string, reason: string) {
  const d = await db();
  await d.transaction(async () => {
    const row = (await d
      .prepare("SELECT run_id, metrics FROM yi_calls WHERE id=?")
      .get(id)) as { run_id: string; metrics: string } | undefined;
    if (!row) return;
    await d
      .prepare(
        "UPDATE yi_calls SET status='released',amount=0,metrics=? WHERE id=?",
      )
      .run(
        JSON.stringify({
          ...parseMetrics(row.metrics),
          release: { reason, at: new Date().toISOString() },
        }),
        id,
      );
    await recomputeCost(String(row.run_id));
  });
}
function parseMetrics(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
/** One ledger row per attempt at a stage, oldest attempt first. */
export type LedgerAttempt = {
  id: string;
  runId: string;
  stage: string;
  attempt: number;
  status: string;
  amount: number;
  metrics: Record<string, unknown>;
  open: boolean;
};
export async function listAttempts(
  runId: string,
  stage: string,
): Promise<LedgerAttempt[]> {
  const d = await db();
  const rows = (await d
    .prepare(
      "SELECT * FROM yi_calls WHERE run_id=? AND stage=? ORDER BY attempt, id",
    )
    .all(runId, stage)) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    runId: String(r.run_id),
    stage: String(r.stage),
    attempt: Number(r.attempt ?? 1),
    status: String(r.status),
    amount: Number(r.amount),
    metrics: parseMetrics(r.metrics),
    open: (OPEN_CALL_STATUSES as readonly string[]).includes(String(r.status)),
  }));
}
export async function heartbeat() {
  await (
    await db()
  )
    .prepare("INSERT OR REPLACE INTO yi_heartbeat VALUES(1,?)")
    .run(Date.now());
}
export async function health() {
  const at =
    (
      (await (
        await db()
      )
        .prepare("SELECT at FROM yi_heartbeat WHERE id=1")
        .get()) as
        | {
            at: number;
          }
        | undefined
    )?.at || 0;
  return {
    workerOnline: Date.now() - at < 620000,
    workerLastSeen: Number(at) || null,
    hasYouTubeKey: !!process.env.YOUTUBE_API_KEY,
    hasModelKey: !!process.env.OPENROUTER_API_KEY,
    budgetUsd: Number(process.env.YTI_BUDGET_USD || "2"),
    spentOrReservedUsd: (
      (await (
        await db()
      )
        .prepare(
          `SELECT COALESCE(SUM(amount),0) AS total FROM yi_calls WHERE ${COUNTED}`,
        )
        .get()) as {
        total: number;
      }
    ).total,
  };
}
export async function retainResponse(
  id: string,
  runId: string,
  stage: string,
  payload: unknown,
) {
  await (
    await db()
  )
    .prepare("INSERT OR IGNORE INTO yi_responses VALUES(?,?,?,?,?)")
    .run(id, runId, stage, JSON.stringify(payload), new Date().toISOString());
}
