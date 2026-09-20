import { advisoryKey, database, iso, json } from "./database.ts";
import { TeamPreferences } from "../../features/youtube-intelligence/settings.ts";
import { resolveTeam } from "./env.ts";
import { enqueueJob } from "./repos/jobs.ts";
import { queuePaused } from "./queue.ts";
import { randomUUID } from "node:crypto";
import type { Run } from "../../features/youtube-intelligence/contracts.ts";
export function db() {
  return database;
}
const LEASE_MS = 600000;
/**
 * The queue lease, kept in one place because yi_runs.lease_until is still epoch
 * milliseconds in a BIGINT column: F24b flips it to timestamptz with the queue
 * paused, and this is the only site that then changes. `released` is a lease no
 * worker holds; `claimable` takes the placeholder that carries `now`.
 */
export const lease = {
  released: 0,
  window: (now = Date.now()) => ({ now, until: now + LEASE_MS }),
  claimable: (now: string) =>
    `status='queued' OR (status='running' AND lease_until<${now})`,
};
/** The all-runs budget check in reserve(), held for the length of one sum. */
const BUDGET_LOCK = advisoryKey("yi:reserve:budget");
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
    createdAt: iso(r.created_at) ?? "",
    updatedAt: iso(r.updated_at) ?? "",
    error: r.error as string | null,
    input: (json(r.input) ?? {}) as Record<string, unknown>,
    output: (json(r.output) ?? {}) as Record<string, unknown>,
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
    .prepare("SELECT * FROM yi_runs WHERE id=$1")
    .get(id)) as Record<string, unknown> | undefined;
  return r ? convert(r) : null;
}
/**
 * Queue one run, at most one open run per (video, model, prompt version, input).
 * The insert is an insert-if-absent against the yi_runs_open_dedupe partial
 * unique index: a concurrent duplicate loses the insert and is answered with the
 * row that won, so no lock is held across the dedupe.
 */
export async function create(
  video: string,
  model: string,
  input: Record<string, unknown>,
  version: string,
) {
  input = (await import("./efficiency.ts")).freezeEfficiency(input);
  const d = await db();
  const payload = JSON.stringify(input);
  const existing = async () =>
    (await d
      .prepare(
        "SELECT id FROM yi_runs WHERE video_id=$1 AND model=$2 AND prompt_version=$3 AND md5(input::text)=md5($4::text) AND status IN ('queued','running')",
      )
      .get(video, model, version, payload)) as { id: string } | undefined;
  return d.transaction(async () => {
    // A conflicting row that finished between the insert and the re-select
    // matches neither, so the insert is offered once more.
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = randomUUID(),
        now = new Date().toISOString();
      const inserted = await d
        .prepare(
          "INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,input,output) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING",
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
          payload,
          "{}",
        );
      if (inserted.changes) {
        await enqueueJob({
          id: `analyze:${id}`,
          kind: "analyze",
          payload: { runId: id },
        });
        return (await get(id))!;
      }
      const old = await existing();
      if (old) return (await get(String(old.id)))!;
    }
    throw Error("Could not queue this analysis; try again.");
  });
}
/**
 * Take the oldest claimable run. FOR UPDATE SKIP LOCKED is what keeps two
 * workers from claiming the same row: the loser steps over the locked row
 * instead of waiting behind it.
 */
export async function claimNext() {
  if (queuePaused()) return null;
  const d = await db();
  return d.transaction(async () => {
    const { now, until } = lease.window();
    const r = (await d
      .prepare(
        `SELECT * FROM yi_runs WHERE ${lease.claimable("$1")} ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      )
      .get(now)) as Record<string, unknown> | undefined;
    if (!r) {
      return null;
    }
    const token = randomUUID();
    await d
      .prepare(
        "UPDATE yi_runs SET status='running',lease_until=$1,lease_token=$2,updated_at=$3 WHERE id=$4",
      )
      .run(until, token, new Date().toISOString(), String(r.id));
    return { run: (await get(String(r.id)))!, token };
  });
}
export async function save(run: Run, token: string) {
  const result = await (
    await db()
  )
    .prepare(
      `UPDATE yi_runs SET title=$1,status=$2,stage=$3,updated_at=$4,error=$5,output=$6,lease_until=${lease.released} WHERE id=$7 AND lease_token=$8 AND lease_until>$9`,
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
      Date.now(),
    );
  if (!result.changes) throw Error("Stale worker lease.");
}
/** An attempt whose outcome is not yet known; it may already have been billed. */
export const OPEN_CALL_STATUSES = ["reserved", "unknown"] as const;
const OPEN = "status IN ('reserved','unknown')";
/** Released reservations hold no money: they count for neither run nor budget. */
const COUNTED = "status<>'released'";
const OPEN_ATTEMPT_MESSAGE =
  "Previous provider call for this stage is still open; recovery is uncertain. Review before retrying.";
function isOpenAttemptConflict(e: unknown) {
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : "";
  return code === "23505" || message.includes("yi_calls_open_attempt");
}
/**
 * Reserve money for one attempt at one stage, keyed by (run_id, stage, attempt).
 * A completed, failed or released attempt no longer blocks the next one; an OPEN
 * attempt does, because a call still running or of unknown outcome may already
 * have been billed. Spec section 4.4.
 *
 * `perVideoCapUsd` is budget.perVideoMaxUsd (spec 6.2): the run's own settled
 * and still-open cost plus this reservation may not pass it, so one video can
 * never spend the month's budget on retries. A cap of 0 or less is no cap.
 *
 * Three narrow guards replace the lock this used to inherit: the
 * yi_calls_open_attempt partial unique index rejects a second open attempt for
 * the stage, FOR UPDATE on the run row serialises reservations against the
 * per-run cap, and a transaction-scoped advisory lock covers the all-runs sum
 * for the length of that one query.
 */
export async function reserve(
  runId: string,
  stage: string,
  amount: number,
  attempt = 1,
  perVideoCapUsd?: number,
) {
  const d = await db();
  return d.transaction(async () => {
    if (
      await d
        .prepare(
          `SELECT id FROM yi_calls WHERE run_id=$1 AND stage=$2 AND ${OPEN}`,
        )
        .get(runId, stage)
    )
      throw Error(OPEN_ATTEMPT_MESSAGE);
    await d.prepare("SELECT id FROM yi_runs WHERE id=$1 FOR UPDATE").get(runId);
    if (
      perVideoCapUsd !== undefined &&
      Number.isFinite(perVideoCapUsd) &&
      perVideoCapUsd > 0
    ) {
      const spent = Number(
        (
          (await d
            .prepare(
              `SELECT COALESCE(SUM(amount),0) AS total FROM yi_calls WHERE run_id=$1 AND ${COUNTED}`,
            )
            .get(runId)) as { total: number }
        ).total,
      );
      if (spent + amount > perVideoCapUsd)
        throw Error(
          `This run has reached its per-video cost limit: US$${spent.toFixed(4)} is already spent or reserved and the "${stage}" call needs US$${amount.toFixed(4)}, above the US$${perVideoCapUsd.toFixed(2)} allowed by budget.perVideoMaxUsd.`,
        );
    }
    await d
      .prepare("SELECT pg_advisory_xact_lock($1::bigint)")
      .get(BUDGET_LOCK);
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
    // Admission uses current administrative limits, never a run's frozen config.
    // Hold the settings row until commit so an existing limit cannot change
    // halfway through the budget decision. The advisory lock serializes spend.
    const current = (await d
      .prepare(
        "SELECT payload FROM yi_documents WHERE kind='teamPreferences' AND id='default' FOR SHARE",
      )
      .get()) as { payload: unknown } | undefined;
    const monthlyLimit = resolveTeam(
      TeamPreferences.parse(json(current?.payload) ?? {}),
    ).budget.monthlyUsd;
    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const commitments = (await d
      .prepare(`SELECT status,amount,metrics FROM yi_calls WHERE ${COUNTED}`)
      .all()) as { status: string; amount: number; metrics: unknown }[];
    const monthlyUsed = commitments.reduce((total, call) => {
      const metrics = (json(call.metrics) ?? {}) as Record<string, unknown>;
      const settledAt =
        typeof metrics.settledAt === "string"
          ? Date.parse(metrics.settledAt)
          : NaN;
      // All open holds and undated legacy charges remain committed. Only a
      // positively dated completed charge before this month can be excluded.
      const previous =
        call.status === "completed" &&
        Number.isFinite(settledAt) &&
        settledAt < monthStart;
      return total + (previous ? 0 : Number(call.amount));
    }, 0);
    if (monthlyUsed + amount > monthlyLimit)
      throw Error(
        `Monthly budget limit reached: US$${monthlyUsed.toFixed(4)} is spent or reserved against US$${monthlyLimit.toFixed(2)} allowed.`,
      );
    const id = randomUUID();
    try {
      await d
        .prepare(
          "INSERT INTO yi_calls(id,run_id,stage,status,amount,metrics,attempt) VALUES($1,$2,$3,$4,$5,$6,$7)",
        )
        .run(
          id,
          runId,
          stage,
          "reserved",
          amount,
          JSON.stringify({ reservedAt: new Date().toISOString() }),
          attempt,
        );
    } catch (e) {
      if (isOpenAttemptConflict(e)) throw Error(OPEN_ATTEMPT_MESSAGE);
      throw e;
    }
    await recomputeCost(runId);
    return id;
  });
}
/** A run's cost is the sum of the rows that still hold or have spent money. */
async function recomputeCost(runId: string) {
  const d = await db();
  await d
    .prepare(
      `UPDATE yi_runs SET cost=(SELECT COALESCE(SUM(amount),0) FROM yi_calls WHERE run_id=$1 AND ${COUNTED}) WHERE id=$2`,
    )
    .run(runId, runId);
}
export async function settle(
  id: string,
  amount: number | null,
  metrics: unknown,
) {
  const d = await db();
  await d.transaction(async () => {
    const row = (await d
      .prepare(
        "UPDATE yi_calls SET status=$1,amount=COALESCE($2,amount),metrics=metrics::jsonb || $3::jsonb WHERE id=$4 RETURNING run_id",
      )
      .get(
        amount === null ? "reserved" : "completed",
        amount,
        JSON.stringify({
          ...(metrics as Record<string, unknown>),
          ...(amount === null ? {} : { settledAt: new Date().toISOString() }),
        }),
        id,
      )) as { run_id: string } | undefined;
    if (row) await recomputeCost(String(row.run_id));
  });
}
/**
 * The outcome of this attempt is not known: the provider may or may not have
 * billed it. The reservation stays (bounded, and still open, so the stage is
 * not retried behind its back) and the row records when the uncertainty began,
 * which is what reconcile.ts measures budget.unknownOutcomeHoldMinutes from.
 * Spec section 4.4.
 */
export async function markUnknown(
  id: string,
  reason: string,
  now = new Date(),
) {
  const d = await db();
  await d.transaction(async () => {
    const row = (await d
      .prepare("SELECT run_id, metrics FROM yi_calls WHERE id=$1 FOR UPDATE")
      .get(id)) as { run_id: string; metrics: string } | undefined;
    if (!row) return;
    await d
      .prepare("UPDATE yi_calls SET status='unknown',metrics=$1 WHERE id=$2")
      .run(
        JSON.stringify({
          ...parseMetrics(row.metrics),
          unknown_since: now.toISOString(),
          unknown_reason: reason,
        }),
        id,
      );
    await recomputeCost(String(row.run_id));
  });
}
/** A held attempt of unknown outcome, oldest uncertainty first. */
export type UnknownCall = {
  id: string;
  runId: string;
  stage: string;
  attempt: number;
  amount: number;
  /** When the outcome became unknown; null for a row written before the field existed. */
  unknownSince: string | null;
  metrics: Record<string, unknown>;
};
/**
 * The reconciliation queue: attempts whose outcome became unknown at or before
 * `before` (an ISO timestamp). The timestamp lives inside the metrics JSON, so
 * the window is applied here rather than in SQL; the queue is a handful of rows
 * at most.
 */
export async function unknownCalls(before: string): Promise<UnknownCall[]> {
  const rows = (await (
    await db()
  )
    .prepare("SELECT * FROM yi_calls WHERE status='unknown'")
    .all()) as Record<string, unknown>[];
  return rows
    .map((r) => {
      const metrics = parseMetrics(r.metrics);
      const since = metrics.unknown_since;
      return {
        id: String(r.id),
        runId: String(r.run_id),
        stage: String(r.stage),
        attempt: Number(r.attempt ?? 1),
        amount: Number(r.amount),
        unknownSince: typeof since === "string" ? since : null,
        metrics,
      };
    })
    .filter(
      (row) => row.metrics.batch !== true && (row.unknownSince ?? "") <= before,
    )
    .sort((a, b) => (a.unknownSince ?? "").localeCompare(b.unknownSince ?? ""));
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
      .prepare("SELECT run_id, metrics FROM yi_calls WHERE id=$1 FOR UPDATE")
      .get(id)) as { run_id: string; metrics: string } | undefined;
    if (!row) return;
    await d
      .prepare(
        "UPDATE yi_calls SET status='released',amount=0,metrics=$1 WHERE id=$2",
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
  const parsed = json(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
/**
 * A settled call's own string field, read out of the metrics JSON. A row
 * written before the field existed, or one that recorded something other than a
 * string, reads as null rather than as a fabricated value.
 */
function metricsText(metrics: Record<string, unknown>, key: string) {
  const value = metrics[key];
  return typeof value === "string" && value ? value : null;
}
/**
 * The three rates a reservation was priced at, read out of the metrics JSON.
 * Anything other than three numbers reads as null rather than as a fabricated
 * table.
 */
function metricsRates(metrics: Record<string, unknown>) {
  const value = metrics.rates;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { input, audio, output } = value as Record<string, unknown>;
  return typeof input === "number" &&
    typeof audio === "number" &&
    typeof output === "number"
    ? { input, audio, output }
    : null;
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
  /**
   * The rate table that priced this attempt's reservation, so a cost recorded
   * months ago can be explained against the rates that produced it; null for a
   * row that recorded none.
   */
  priceTableVersion: string | null;
  /**
   * The input, audio and output rates that priced it. A transport pricing from
   * a catalogue it fetched for that one call names no table version, so these
   * are the only record of what the hold was arithmetic over; null for a row
   * that recorded none.
   */
  reservationRates: { input: number; audio: number; output: number } | null;
  open: boolean;
};
export async function listAttempts(
  runId: string,
  stage: string,
): Promise<LedgerAttempt[]> {
  const d = await db();
  const rows = (await d
    .prepare(
      "SELECT * FROM yi_calls WHERE run_id=$1 AND stage=$2 ORDER BY attempt, id",
    )
    .all(runId, stage)) as Record<string, unknown>[];
  return rows.map((r) => {
    const metrics = parseMetrics(r.metrics);
    return {
      id: String(r.id),
      runId: String(r.run_id),
      stage: String(r.stage),
      attempt: Number(r.attempt ?? 1),
      status: String(r.status),
      amount: Number(r.amount),
      metrics,
      priceTableVersion: metricsText(metrics, "priceTableVersion"),
      reservationRates: metricsRates(metrics),
      open: (OPEN_CALL_STATUSES as readonly string[]).includes(
        String(r.status),
      ),
    };
  });
}
export async function heartbeat() {
  await (
    await db()
  )
    .prepare(
      "INSERT INTO yi_heartbeat(id,at) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET at=excluded.at",
    )
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
/**
 * The provider response kept for one call id, if one was kept. An unknown
 * outcome whose response was retained can be settled from what it reports
 * instead of being released on guesswork.
 */
export async function retainedResponse(id: string): Promise<unknown> {
  const row = (await (
    await db()
  )
    .prepare("SELECT payload FROM yi_responses WHERE id=$1")
    .get(id)) as { payload: unknown } | undefined;
  return row ? (json(row.payload) ?? undefined) : undefined;
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
    .prepare(
      "INSERT INTO yi_responses(id,run_id,stage,payload,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
    )
    .run(id, runId, stage, JSON.stringify(payload), new Date().toISOString());
}
/** Crash-left reservations become explicit reconciliation jobs once the hold
 * expires and no live queue lease can still be using the provider response. */
export async function enqueueExpiredReservations(
  holdMinutes: number,
  now = Date.now(),
) {
  const cutoff = new Date(now - Math.max(0, holdMinutes) * 60000).toISOString();
  const rows = await db()
    .prepare(
      `SELECT c.id,c.run_id,c.metrics FROM yi_calls c
  WHERE c.status IN ('reserved','unknown') AND COALESCE(c.metrics::jsonb->>'batch','false')<>'true'
  AND COALESCE(c.metrics::jsonb->>'unknown_since',c.metrics::jsonb->>'reservedAt','')<=$1
  AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.payload->>'runId'=c.run_id AND j.status='running' AND j.lease_until>now())`,
    )
    .all(cutoff);
  for (const row of rows) {
    await db().transaction(async () => {
      const metrics = parseMetrics(row.metrics);
      await markUnknown(
        String(row.id),
        "Worker reservation exceeded its hold without an active lease",
        new Date(
          typeof metrics.unknown_since === "string"
            ? metrics.unknown_since
            : typeof metrics.reservedAt === "string"
              ? metrics.reservedAt
              : cutoff,
        ),
      );
      await enqueueJob({
        id: `reconcile:${row.id}`,
        kind: "reconcile",
        payload: { callId: String(row.id) },
      });
    });
  }
  return rows.length;
}
