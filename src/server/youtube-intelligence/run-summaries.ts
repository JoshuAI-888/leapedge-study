import { z } from "zod";
import { database, iso, json } from "./database.ts";
import type { Run } from "../../features/youtube-intelligence/contracts.ts";
const Cursor = z.object({
  at: z.iso.datetime(),
  id: z.string().min(1).max(100),
});
const Query = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(1000).optional(),
  ids: z.array(z.uuid()).min(1).max(100).optional(),
});
/** Projection happens in Postgres: transcripts, provider requests and evidence never cross this boundary. */
export async function runSummaryPage(input: unknown = {}) {
  const query = Query.parse(input);
  const { cursor, ids } = query;
  const limit = ids?.length ?? query.limit;
  if (ids && cursor) throw Error("Choose IDs or a cursor, not both.");
  const after = cursor
    ? Cursor.parse(JSON.parse(Buffer.from(cursor, "base64url").toString()))
    : null;
  const where = ids
    ? "AND id=ANY($2::text[])"
    : after
      ? "AND (created_at,id)<($2,$3)"
      : "";
  // Materialize the bounded page before parsing: yi_runs stores legacy TEXT
  // JSON, and repeated output::jsonb expressions otherwise parse megabytes
  // again for every selected field and aggregate (and sometimes before LIMIT).
  const rows = await database
    .prepare(
      `
    WITH page AS MATERIALIZED (
      SELECT id,video_id,url,model,prompt_version,title,status,stage,
        created_at,updated_at,error,cost,input,output
      FROM yi_runs
      WHERE input::jsonb->>'task' IS NULL
        ${where}
      ORDER BY created_at DESC,id DESC LIMIT $1
    ), parsed AS MATERIALIZED (
      SELECT id,video_id,url,model,prompt_version,title,status,stage,
        created_at,updated_at,error,cost,
        input::jsonb->>'recoveryOf' AS recovery_of,output::jsonb AS result
      FROM page
    )
    SELECT id,video_id,url,model,prompt_version,title,status,stage,
      created_at,updated_at,error,cost,recovery_of,
      jsonb_build_object(
        'metadata',result->'metadata','sourceHash',result->'sourceHash','coverage',result->'coverage',
        'acceptedEvidenceCount',claims.accepted+points.accepted,
        'rejectedEvidenceCount',claims.rejected+points.rejected,
        'acceptedCount',CASE WHEN status='completed' THEN claims.accepted END,
        'rejectedCount',CASE WHEN status='completed' THEN claims.rejected END
      ) AS summary
    FROM parsed
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE c->>'passed'='true') AS accepted,
        count(*) FILTER (WHERE COALESCE(c->>'passed','false')!='true') AS rejected
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(result->'claims')='array'
        THEN result->'claims' ELSE '[]'::jsonb END) c
    ) claims
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE c->>'passed'='true') AS accepted,
        count(*) FILTER (WHERE COALESCE(c->>'passed','false')!='true') AS rejected
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(result->'keyPoints')='array'
        THEN result->'keyPoints' ELSE '[]'::jsonb END) c
    ) points
    ORDER BY created_at DESC,id DESC
  `,
    )
    .all(limit + 1, ...(ids ? [ids] : after ? [after.at, after.id] : []));
  const runs: Run[] = rows.slice(0, limit).map((r) => ({
    id: String(r.id),
    videoId: String(r.video_id),
    url: String(r.url),
    model: String(r.model),
    promptVersion: String(r.prompt_version),
    title: String(r.title),
    status: String(r.status),
    stage: String(r.stage),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    error: r.error as string | null,
    cost: Number(r.cost),
    input: z.uuid().safeParse(r.recovery_of).success
      ? { recoveryOf: r.recovery_of }
      : {},
    output: json(r.summary) as Record<string, unknown>,
  }));
  const last = runs.at(-1);
  return {
    runs,
    nextCursor:
      !ids && rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({ at: last.createdAt, id: last.id }),
          ).toString("base64url")
        : null,
  };
}
/** Constant-size revision + bounded statuses; never loads model outputs or documents. */
export async function workspaceActivity() {
  const [active, terminal, latest, terminalCount] = await Promise.all([
    database
      .prepare(
        "SELECT id,status,stage,title,error,cost,updated_at FROM yi_runs WHERE status IN ('queued','running') ORDER BY created_at DESC,id DESC LIMIT 201",
      )
      .all(),
    database
      .prepare(
        "SELECT id,updated_at FROM yi_runs WHERE status NOT IN ('queued','running') ORDER BY updated_at DESC,id DESC LIMIT 1",
      )
      .get(),
    database
      .prepare(
        "SELECT id,created_at FROM yi_runs ORDER BY created_at DESC,id DESC LIMIT 1",
      )
      .get(),
    database
      .prepare(
        "SELECT count(*) AS count FROM yi_runs WHERE status NOT IN ('queued','running')",
      )
      .get(),
  ]);
  return {
    active: active.slice(0, 200).map((r) => ({
      id: String(r.id),
      status: String(r.status),
      stage: String(r.stage),
      title: String(r.title),
      error: r.error as string | null,
      cost: Number(r.cost),
      updatedAt: iso(r.updated_at)!,
    })),
    activeTruncated: active.length > 200,
    terminalRevision: terminal
      ? `${terminal.id}:${iso(terminal.updated_at)}:${terminalCount?.count}`
      : "empty",
    latestRunId: latest ? String(latest.id) : null,
  };
}
