import { database, iso, json } from "../database.ts";
/**
 * The only door to the `transcripts` table (spec 8). A row is immutable: it is
 * inserted if absent and never updated, so a second transcript of the same
 * video is a new row with its own kind, provider and hash.
 *
 * `segments` holds the whole retained transcript and is megabytes on a long
 * video, so no list query selects it. Every listing reads PROJECTION; the text
 * itself comes back only from segmentsFor(), one row at a time.
 */
export const TRANSCRIPT_KINDS = [
  "caption",
  "asr-window",
  "whisper",
  "merged",
] as const;
export type TranscriptKind = (typeof TRANSCRIPT_KINDS)[number];
export type TranscriptRow = {
  id: string;
  videoId: string;
  kind: TranscriptKind;
  provider: string | null;
  language: string | null;
  hash: string | null;
  createdAt: string | null;
};
export type TranscriptInput = Omit<TranscriptRow, "createdAt"> & {
  segments: unknown;
  createdAt?: string;
};
/**
 * Everything but `segments`. A table view must not drag the text across the
 * pooler. Exported so a test can assert on the column list itself: the row
 * converter below builds a fixed object, so a listing would look identical
 * whether or not the query selected the text, and asserting on the result
 * cannot catch `segments` being added back here.
 */
export const PROJECTION = "id,video_id,kind,provider,language,hash,created_at";
function convert(r: Record<string, unknown>): TranscriptRow {
  const kind = String(r.kind);
  return {
    id: String(r.id),
    videoId: String(r.video_id),
    kind: (TRANSCRIPT_KINDS as readonly string[]).includes(kind)
      ? (kind as TranscriptKind)
      : "caption",
    provider: r.provider === null ? null : String(r.provider),
    language: r.language === null ? null : String(r.language),
    hash: r.hash === null ? null : String(r.hash),
    createdAt: iso(r.created_at),
  };
}
/** Insert if absent. Reports false when the row was already there. */
export async function insertTranscript(input: TranscriptInput) {
  const result = await database
    .prepare(
      "INSERT INTO transcripts(id,video_id,kind,provider,language,hash,segments,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT(id) DO NOTHING",
    )
    .run(
      input.id,
      input.videoId,
      input.kind,
      input.provider,
      input.language,
      input.hash,
      JSON.stringify(input.segments ?? []),
      input.createdAt ?? new Date().toISOString(),
    );
  return result.changes > 0;
}
export async function listTranscripts(
  limit = 200,
  videoId?: string,
): Promise<TranscriptRow[]> {
  const rows = videoId
    ? await database
        .prepare(
          `SELECT ${PROJECTION} FROM transcripts WHERE video_id=$1 ORDER BY created_at DESC,id LIMIT $2`,
        )
        .all(videoId, limit)
    : await database
        .prepare(
          `SELECT ${PROJECTION} FROM transcripts ORDER BY created_at DESC,id LIMIT $1`,
        )
        .all(limit);
  return (rows as Record<string, unknown>[]).map(convert);
}
/** The retained text of one transcript. The only query that reads `segments`. */
export async function segmentsFor(id: string): Promise<unknown> {
  const r = (await database
    .prepare("SELECT segments FROM transcripts WHERE id=$1")
    .get(id)) as { segments: unknown } | undefined;
  return r ? json(r.segments) : null;
}
export async function countTranscripts(kind?: TranscriptKind): Promise<number> {
  const r = (
    kind
      ? await database
          .prepare("SELECT COUNT(*) AS n FROM transcripts WHERE kind=$1")
          .get(kind)
      : await database.prepare("SELECT COUNT(*) AS n FROM transcripts").get()
  ) as { n: unknown };
  return Number(r.n);
}
