import { z } from "zod";
import { database, iso, json } from "./database.ts";
import { CANONICAL_RUNS_SQL, queryVideos } from "./repos/research-query.ts";
import { buildBriefing } from "./briefings.ts";
import { queueBriefing } from "./briefing-pipeline.ts";
import {
  isTradingDay,
  previousSession,
  sessionFor,
  sessionWindow,
} from "../../features/youtube-intelligence/trading-day.ts";
import {
  MIN_SYNTHESIS_VIDEOS,
  assembleReport,
  buildArchive,
  snapSession,
  type DailyReport,
  type ReportCall,
  type ReportVideo,
  type SynthesisInput,
  type SynthesisPoint,
} from "../../features/youtube-intelligence/report.ts";

/**
 * F64: the daily report for one US trading session, read from stored calls.
 * Reading never calls a model and never writes: the synthesis is the existing
 * briefing pipeline (buildBriefing → queueBriefing → briefingStep with its
 * critic audit), started only by `synthesizeReport`.
 */
const Day = z.iso.date();
export const SessionInput = z.preprocess(
  (v) => v ?? {},
  z.strictObject({ session: Day.optional(), now: z.iso.datetime().optional() }),
);
export const ArchiveInput = z.preprocess(
  (v) => v ?? {},
  z.strictObject({
    limit: z.number().int().min(1).max(260).default(60),
    offset: z.number().int().min(0).max(100_000).default(0),
  }),
);
export const SynthesizeInput = z.strictObject({ session: Day });

type Row = Record<string, unknown>;
const rows = async (sql: string, values: unknown[] = []) =>
  (await database.prepare(sql).all(...values)) as Row[];
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Canonical calls published inside [from, to), with each call's first quote. */
async function callsBetween(from: string, to: string): Promise<ReportCall[]> {
  const found = await rows(
    `WITH canon AS MATERIALIZED (${CANONICAL_RUNS_SQL})
     SELECT c.id,c.run_id,c.video_id,c.channel_id,c.instrument,c.ticker,c.stance,
       c.creator_conviction,c.trust_level,c.thesis_en,
       COALESCE(c.published_at,c.created_at) AS at,
       r.title AS video_title,ch.title AS channel_title,
       s.text_original,s.translation_en,s.start_seconds
     FROM claims c
     LEFT JOIN yi_runs r ON r.id=c.run_id
     LEFT JOIN channels ch ON ch.id=c.channel_id
     LEFT JOIN LATERAL (SELECT * FROM evidence_spans e WHERE e.claim_id=c.id
       ORDER BY e.ordinal LIMIT 1) s ON TRUE
     WHERE c.run_id IN (SELECT id FROM canon)
       AND COALESCE(c.published_at,c.created_at) >= $1::timestamptz
       AND COALESCE(c.published_at,c.created_at) < $2::timestamptz
     ORDER BY at, c.id`,
    [from, to],
  );
  return found.map((r) => {
    const id = String(r.id),
      runId = String(r.run_id);
    return {
      id,
      runId,
      claimId: id.startsWith(`${runId}:`) ? id.slice(runId.length + 1) : id,
      videoId: String(r.video_id),
      videoTitle: str(r.video_title),
      channelId: str(r.channel_id),
      channelTitle: str(r.channel_title),
      instrument: str(r.instrument),
      ticker: str(r.ticker),
      stance: String(r.stance),
      conviction: String(r.creator_conviction),
      trustLevel: String(r.trust_level),
      thesis: String(r.thesis_en),
      publishedAt: iso(r.at),
      quote:
        r.text_original === null || r.text_original === undefined
          ? null
          : {
              text: String(r.text_original),
              translation: str(r.translation_en),
              startSeconds:
                r.start_seconds === null ? null : Number(r.start_seconds),
            },
    };
  });
}
/** Canonical videos of the window, every page (the query API caps a page at 100). */
async function videosBetween(from: string, to: string): Promise<ReportVideo[]> {
  const out: ReportVideo[] = [];
  for (let offset = 0; ; ) {
    const page = await queryVideos({ from, to, limit: 100, offset });
    for (const v of page.rows)
      out.push({
        runId: v.runId,
        videoId: v.videoId,
        title: v.title,
        channelId: v.channelId,
        channelTitle: v.channelTitle,
        publishedAt: v.publishedAt,
        ideas: v.ideas,
        sentiment: v.sentiment,
        instruments: v.instruments,
      });
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  return out;
}
const Points = z.array(
  z.object({
    text_en: z.string(),
    refs: z.array(z.object({ runId: z.string(), claimId: z.string() })),
    passed: z.boolean(),
    reason: z.string().nullable().default(null),
  }),
);
/** The session's synthesis runs (task "briefing" with a session snapshot). */
async function synthesisFor(session: string): Promise<SynthesisInput> {
  const runs = await rows(
    `SELECT id,status,error,created_at,output::jsonb->>'briefingId' AS briefing_id
     FROM yi_runs
     WHERE (input::jsonb->>'task')='briefing'
       AND (input::jsonb->'snapshot'->>'session')=$1
     ORDER BY created_at DESC, id DESC LIMIT 20`,
    [session],
  );
  const latest = runs[0];
  const done = runs.find((r) => r.status === "completed" && r.briefing_id);
  let completed: SynthesisInput["completed"] = null;
  if (done) {
    const found = await rows(
      "SELECT payload FROM yi_documents WHERE kind='briefing' AND id=$1",
      [String(done.briefing_id)],
    );
    const payload = found[0] ? (json(found[0].payload) as Row) : null;
    const points = Points.safeParse(payload?.summaryPoints ?? []);
    if (payload && points.success)
      completed = {
        runId: String(done.id),
        briefingId: String(done.briefing_id),
        createdAt: String(payload.createdAt ?? iso(done.created_at)),
        model: str(payload.model),
        runIds: Array.isArray(payload.runIds) ? payload.runIds.map(String) : [],
        points: points.data as SynthesisPoint[],
      };
  }
  return {
    latestRun: latest
      ? {
          id: String(latest.id),
          status: String(latest.status),
          error: str(latest.error),
          createdAt: iso(latest.created_at) ?? "",
        }
      : null,
    completed,
  };
}
/** The mean cost of past completed syntheses, the only estimate there is. */
async function costEstimate(): Promise<DailyReport["costEstimate"]> {
  const [r] = await rows(
    `SELECT avg(cost) AS usd,count(*) AS n FROM yi_runs
     WHERE (input::jsonb->>'task')='briefing' AND status='completed' AND cost>0`,
  );
  const n = Number(r?.n ?? 0);
  return n ? { usd: Number(r.usd), basis: n } : null;
}
/** The newest session with any canonical call, or null. */
async function latestSessionWithCalls(current: string) {
  const [r] = await rows(
    `WITH canon AS MATERIALIZED (${CANONICAL_RUNS_SQL})
     SELECT max(COALESCE(c.published_at,c.created_at)) AS at FROM claims c
     WHERE c.run_id IN (SELECT id FROM canon)
       AND COALESCE(c.published_at,c.created_at) < $1::timestamptz`,
    [sessionWindow(current).to],
  );
  const at = iso(r?.at);
  return at ? sessionFor(at).session : null;
}

export async function loadDailyReport(input: unknown): Promise<
  DailyReport & { requested: string | null; latest: string | null }
> {
  const q = SessionInput.parse(input);
  const now = q.now ?? new Date().toISOString();
  const current = sessionFor(now).session;
  const latest = await latestSessionWithCalls(current);
  const session = q.session
    ? snapSession(q.session, current)
    : (latest ?? current);
  const window = sessionWindow(session);
  const before = sessionWindow(previousSession(session));
  const [calls, previousCalls, videos, synthesis, cost] = await Promise.all([
    callsBetween(window.from, window.to),
    callsBetween(before.from, before.to),
    videosBetween(window.from, window.to),
    synthesisFor(session),
    costEstimate(),
  ]);
  return {
    ...assembleReport({
      session,
      current,
      now,
      calls,
      previousCalls,
      videos,
      synthesis,
      costEstimate: cost,
    }),
    requested: q.session ?? null,
    latest,
  };
}

/** Past sessions with calls, newest first, each with its headline and split. */
export async function loadReportArchive(input: unknown) {
  const q = ArchiveInput.parse(input);
  const [calls, heads] = await Promise.all([
    rows(
      `WITH canon AS MATERIALIZED (${CANONICAL_RUNS_SQL})
       SELECT COALESCE(c.published_at,c.created_at) AS at,c.channel_id,c.run_id,c.stance
       FROM claims c WHERE c.run_id IN (SELECT id FROM canon)`,
    ),
    rows(
      `SELECT DISTINCT ON (input::jsonb->'snapshot'->>'session')
         input::jsonb->'snapshot'->>'session' AS session,
         output::jsonb->>'briefingId' AS briefing_id
       FROM yi_runs
       WHERE (input::jsonb->>'task')='briefing' AND status='completed'
         AND (input::jsonb->'snapshot'->>'session') IS NOT NULL
       ORDER BY input::jsonb->'snapshot'->>'session', created_at DESC, id DESC`,
    ),
  ]);
  const ids = heads.map((h) => str(h.briefing_id)).filter((v): v is string => !!v);
  const docs = ids.length
    ? await rows(
        "SELECT id,payload FROM yi_documents WHERE kind='briefing' AND id = ANY($1::text[])",
        [ids],
      )
    : [];
  const headlines = new Map<string, string>();
  for (const h of heads) {
    const payload = docs.find((d) => d.id === h.briefing_id);
    const points = Points.safeParse(
      payload ? (json(payload.payload) as Row).summaryPoints : [],
    );
    const first = points.success ? points.data.find((p) => p.passed) : undefined;
    if (first) headlines.set(String(h.session), first.text_en);
  }
  const all = buildArchive(
    calls.flatMap((c) => {
      const at = iso(c.at);
      if (!at) return [];
      return [
        {
          session: sessionFor(at).session,
          channelId: str(c.channel_id),
          runId: String(c.run_id),
          stance: String(c.stance),
        },
      ];
    }),
    headlines,
  );
  return {
    rows: all.slice(q.offset, q.offset + q.limit),
    total: all.length,
    limit: q.limit,
    offset: q.offset,
  };
}

/**
 * Start the synthesis for a session: the existing briefing pipeline, which
 * makes model calls (writer and critic) and so may spend. Refused for fewer
 * than MIN_SYNTHESIS_VIDEOS videos.
 */
export async function synthesizeReport(input: unknown) {
  const { session } = SynthesizeInput.parse(input);
  if (!isTradingDay(session))
    throw Error("That date is not a US trading session.");
  const window = sessionWindow(session);
  const videos = await videosBetween(window.from, window.to);
  if (videos.length < MIN_SYNTHESIS_VIDEOS)
    throw Error(
      `This session has ${videos.length} video${videos.length === 1 ? "" : "s"}; a summary needs at least ${MIN_SYNTHESIS_VIDEOS}.`,
    );
  const briefing = await buildBriefing(session, { session: true });
  const run = await queueBriefing(briefing.id);
  return { runId: run.id, status: run.status, session };
}
