import { database, iso, json } from "../database.ts";
/**
 * The only door to the `channels` table (spec 8). Nothing outside repos/
 * reads or writes it.
 *
 * Writes are guarded by the primary key and ON CONFLICT rather than by a lock:
 * two workers upserting the same channel agree on the row the second one
 * leaves behind, and neither waits for the other.
 */
/**
 * Two switches on a channel row, and they are not the same switch.
 *
 * `discovery` says how a channel's uploads are found: `scheduled` is the free
 * metadata poll, `manual` is only when somebody asks. `processing` says what
 * happens to an upload once it is found: `automatic` spends money on the
 * analysis pipeline without asking, `on-request` waits for a person.
 *
 * `processing` is the readable statement of the same decision `auto_analyze`
 * gates on, so every writer of one writes the other, and pullDue refuses to
 * spend when they disagree. They live here rather than in seed/ because they
 * are values of these columns, and channels.ts writes them too.
 */
export const DISCOVERY_SCHEDULED = "scheduled";
export const PROCESSING_AUTOMATIC = "automatic";
export const PROCESSING_ON_REQUEST = "on-request";
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
 * The field names a channel carries into this repository. channels.ts passes
 * them directly (F28); scripts/migrate-documents.ts passes a stored `channel`
 * document, whose payload uses the same names, so one upsert serves both.
 */
export type ChannelFields = {
  id?: unknown;
  title?: unknown;
  handle?: unknown;
  uploads?: unknown;
  active?: unknown;
  favorite?: unknown;
  autoAnalyze?: unknown;
  createdAt?: unknown;
  followedAt?: unknown;
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
 * Upsert one channel. Fields the caller does not carry — tier, seed source,
 * discovery and processing mode, which the seed fills — are never overwritten
 * with a null.
 */
export async function upsertChannel(payload: ChannelFields) {
  const id = text(payload.id);
  if (!id) throw Error("A channel row needs an id.");
  const createdAt = iso(payload.createdAt) ?? new Date().toISOString();
  // followed_at is the moment somebody followed the channel, and pullDue uses
  // it as the cut-off for which uploads automatic analysis pays for. A seeded
  // row was created long before anyone followed it, so it must not fall back to
  // created_at: that would buy the whole back catalogue since the seed run.
  const followedAt = iso(payload.followedAt);
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
      followedAt,
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
/**
 * The names the one-off document migration imports. A stored `channel`
 * document carries exactly these fields, so it upserts through the same
 * statement as a live write.
 */
export type ChannelDocument = ChannelFields;
export const upsertFromDocument = upsertChannel;
/** What the seed lists know about a channel before anyone has followed it. */
export type ChannelSeed = {
  id: string;
  handle: string;
  title: string;
  tier: string;
  seedSource: string[];
  discovery: string;
  processing: string;
};
/**
 * Seed one channel, or fold another list's entry into the one already there.
 *
 * A re-seed must leave everything a person or a later stage decided alone, so
 * the conflict branch only ever adds: the seed sources union, the tier follows
 * the lists because that is what they are for, a title or handle is filled in
 * when it is still empty, and discovery, processing, active, favorite,
 * auto_analyze, the polling cursor and created_at keep whatever they hold.
 * Seeding twice therefore leaves the same rows the first run did.
 *
 * A seeded row starts inactive and with automatic analysis off. It names a
 * channel worth watching, not one that is being polled or paid for.
 */
export async function seedChannel(seed: ChannelSeed) {
  await database
    .prepare(
      `INSERT INTO channels(id,handle,title,tier,seed_source,discovery,processing,auto_analyze,active)
       VALUES($1,$2,$3,$4,$5,$6,$7,false,false)
       ON CONFLICT(id) DO UPDATE SET
         handle=CASE WHEN COALESCE(channels.handle,'')='' THEN excluded.handle ELSE channels.handle END,
         title=CASE WHEN COALESCE(channels.title,'')='' THEN excluded.title ELSE channels.title END,
         tier=excluded.tier,
         seed_source=(
           SELECT COALESCE(array_agg(DISTINCT s ORDER BY s),'{}')
           FROM unnest(channels.seed_source || excluded.seed_source) AS s
         ),
         discovery=COALESCE(channels.discovery,excluded.discovery),
         processing=COALESCE(channels.processing,excluded.processing)`,
    )
    .run(
      seed.id,
      seed.handle,
      seed.title,
      seed.tier,
      seed.seedSource,
      seed.discovery,
      seed.processing,
    );
}
/**
 * Project a selection onto the seeded rows: the named channels are marked for
 * automatic analysis and every other seeded channel is not. The selection
 * itself lives in versioned configuration, so this is a derived state that a
 * later version overwrites, never the record of the decision.
 *
 * Only rows a seed list named are touched. A channel somebody followed by hand
 * is theirs, and a selection must not switch paid analysis on or off under it.
 */
export async function setAutomaticAnalysis(
  selected: string[],
  automatic: string,
  onRequest: string,
) {
  const result = await database
    .prepare(
      `UPDATE channels
          SET auto_analyze=(id=ANY($1::text[])),
              processing=CASE WHEN id=ANY($1::text[]) THEN $2 ELSE $3 END
        WHERE cardinality(seed_source)>0`,
    )
    .run(selected, automatic, onRequest);
  return result.changes;
}
/** The seeded channels, whatever their tier, oldest first. */
export async function listSeededChannels(): Promise<ChannelRow[]> {
  return (
    (await database
      .prepare(
        `SELECT ${COLUMNS} FROM channels WHERE cardinality(seed_source)>0 ORDER BY created_at,id`,
      )
      .all()) as Record<string, unknown>[]
  ).map(convert);
}
