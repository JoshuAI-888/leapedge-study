import { database, iso, json } from "../database.ts";
/**
 * The only door to the `channels` table (spec 8). Nothing outside repos/
 * reads or writes it.
 *
 * Writes are guarded by the primary key and ON CONFLICT rather than by a lock:
 * two workers upserting the same channel agree on the row the second one
 * leaves behind, and neither waits for the other.
 */
export type ChannelRow = {
  id: string;
  handle: string;
  title: string;
  tier: string | null;
  seedSource: string[];
  discovery: string | null;
  processing: string | null;
  autoAnalyze: boolean;
  followedAt: string | null;
  uploads: string;
  active: boolean;
  favorite: boolean;
  lastPull: string | null;
  lastAttempt: string | null;
  nextPullAt: string | null;
  nextPageToken: string | null;
  historyStarted: boolean;
  error: string | null;
  createdAt: string | null;
};
/**
 * The shape channels.ts still writes as a `channel` document. It is read here
 * and nowhere else, so the one place that knows both shapes is this module.
 */
export type ChannelDocument = {
  id?: unknown;
  title?: unknown;
  handle?: unknown;
  uploads?: unknown;
  active?: unknown;
  favorite?: unknown;
  autoAnalyze?: unknown;
  createdAt?: unknown;
  lastPull?: unknown;
  lastAttempt?: unknown;
  nextPullAt?: unknown;
  nextPageToken?: unknown;
  historyStarted?: unknown;
  error?: unknown;
  tier?: unknown;
  seedSource?: unknown;
  discovery?: unknown;
  processing?: unknown;
};
const COLUMNS =
  "id,handle,title,tier,seed_source,discovery,processing,auto_analyze,followed_at,uploads,active,favorite,last_pull,last_attempt,next_pull_at,next_page_token,history_started,error,created_at";
function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
function convert(r: Record<string, unknown>): ChannelRow {
  const seed = json(r.seed_source);
  return {
    id: String(r.id),
    handle: String(r.handle ?? ""),
    title: String(r.title ?? ""),
    tier: text(r.tier),
    seedSource: Array.isArray(seed) ? seed.map((s) => String(s)) : [],
    discovery: text(r.discovery),
    processing: text(r.processing),
    autoAnalyze: r.auto_analyze === true,
    followedAt: iso(r.followed_at),
    uploads: String(r.uploads ?? ""),
    active: r.active === true,
    favorite: r.favorite === true,
    lastPull: iso(r.last_pull),
    lastAttempt: iso(r.last_attempt),
    nextPullAt: iso(r.next_pull_at),
    nextPageToken: text(r.next_page_token),
    historyStarted: r.history_started === true,
    error: text(r.error),
    createdAt: iso(r.created_at),
  };
}
/**
 * Upsert one channel from the document channels.ts still writes. Fields the
 * document does not carry — tier, seed source, discovery and processing mode,
 * which the seed item fills — are never overwritten with a null.
 */
export async function upsertFromDocument(payload: ChannelDocument) {
  const id = text(payload.id);
  if (!id) throw Error("A channel row needs an id.");
  const createdAt = iso(payload.createdAt) ?? new Date().toISOString();
  const seed = Array.isArray(payload.seedSource)
    ? payload.seedSource.map((s) => String(s))
    : [];
  const result = await database
    .prepare(
      `INSERT INTO channels(${COLUMNS}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT(id) DO UPDATE SET
         handle=excluded.handle,
         title=excluded.title,
         tier=COALESCE(excluded.tier,channels.tier),
         seed_source=CASE WHEN cardinality(excluded.seed_source)>0 THEN excluded.seed_source ELSE channels.seed_source END,
         discovery=COALESCE(excluded.discovery,channels.discovery),
         processing=COALESCE(excluded.processing,channels.processing),
         auto_analyze=excluded.auto_analyze,
         followed_at=COALESCE(channels.followed_at,excluded.followed_at),
         uploads=excluded.uploads,
         active=excluded.active,
         favorite=excluded.favorite,
         last_pull=excluded.last_pull,
         last_attempt=excluded.last_attempt,
         next_pull_at=excluded.next_pull_at,
         next_page_token=excluded.next_page_token,
         history_started=excluded.history_started,
         error=excluded.error`,
    )
    .run(
      id,
      text(payload.handle) ?? "",
      text(payload.title) ?? "",
      text(payload.tier),
      seed,
      text(payload.discovery),
      text(payload.processing),
      payload.autoAnalyze === true,
      createdAt,
      text(payload.uploads) ?? "",
      payload.active !== false,
      payload.favorite === true,
      iso(payload.lastPull),
      iso(payload.lastAttempt),
      iso(payload.nextPullAt),
      text(payload.nextPageToken),
      payload.historyStarted === true,
      text(payload.error),
      createdAt,
    );
  return result.changes > 0;
}
export async function listChannels(): Promise<ChannelRow[]> {
  return (
    (await database
      .prepare(`SELECT ${COLUMNS} FROM channels ORDER BY created_at DESC,id`)
      .all()) as Record<string, unknown>[]
  ).map(convert);
}
export async function getChannel(id: string): Promise<ChannelRow | null> {
  const r = (await database
    .prepare(`SELECT ${COLUMNS} FROM channels WHERE id=$1`)
    .get(id)) as Record<string, unknown> | undefined;
  return r ? convert(r) : null;
}
export async function countChannels(): Promise<number> {
  const r = (await database
    .prepare("SELECT COUNT(*) AS n FROM channels")
    .get()) as { n: unknown };
  return Number(r.n);
}
