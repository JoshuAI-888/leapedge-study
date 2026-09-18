import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  database,
  iso,
  json,
  useDirectConnection,
} from "../src/server/youtube-intelligence/database.ts";
import { assertIsolatedDatabase } from "../src/server/youtube-intelligence/migrations/run.ts";
import { get } from "../src/server/youtube-intelligence/store.ts";
import {
  upsertFromDocument as upsertChannelRow,
  countChannels,
  type ChannelDocument,
} from "../src/server/youtube-intelligence/repos/channels.ts";
import {
  insertTranscript,
  countTranscripts,
} from "../src/server/youtube-intelligence/repos/transcripts.ts";
import { countClaims } from "../src/server/youtube-intelligence/repos/claims.ts";
import { countMentions } from "../src/server/youtube-intelligence/repos/mentions.ts";
import { countEvidenceSpans } from "../src/server/youtube-intelligence/repos/evidence-spans.ts";
import {
  rowsForRun,
  writeRunRows,
} from "../src/server/youtube-intelligence/repos/publish.ts";
/**
 * Move the lab's stored documents into the relational tables 0003 created
 * (spec 8), once, on a database that already holds real research.
 *
 *   node --experimental-strip-types scripts/migrate-documents.ts --dry-run
 *   node --experimental-strip-types scripts/migrate-documents.ts
 *   node --experimental-strip-types scripts/migrate-documents.ts --verify
 *
 * Three properties matter more than speed:
 *
 *   - --dry-run writes nothing and reports, per kind, how many documents it
 *     would read and how many rows it would write.
 *   - the default run is idempotent. Every row id derives from the document or
 *     the run it came from, so a second run writes nothing, and an interrupted
 *     one resumes: each row is its own statement, so what was written stays
 *     written and what was not is picked up next time.
 *   - --verify counts documents against rows afterwards and exits non-zero on
 *     a mismatch, naming the kind.
 *
 * It never deletes a source document. Deleting them is a later step, once the
 * rows are trusted, and until then the documents remain the restore point:
 * `npm run research:export` still captures everything this script read.
 */
export const MIGRATE_DOCUMENTS_VERSION = "migrate-documents.v1";
export const USAGE = [
  "Usage:",
  "  node --experimental-strip-types scripts/migrate-documents.ts [--dry-run | --verify] [--production]",
  "",
  "  --dry-run      report what would be read and written; write nothing",
  "  --verify       compare document counts to row counts; exit 1 on a mismatch",
  "  --production   skip the isolated-database guard, for the real run",
  "",
  "  Add --env-file=.env before --experimental-strip-types to read a live DATABASE_URL.",
  "  Rehearse on a Neon branch first: docs/production-and-integration.md.",
].join("\n");
/** A bad command line: the caller exits 2 and prints USAGE. */
export class FlagError extends Error {
  override name = "FlagError";
}
export type Mode = "migrate" | "dry-run" | "verify";
export type MigrateOptions = { mode: Mode; production: boolean };
export function parseOptions(argv: string[]): MigrateOptions {
  let mode: Mode = "migrate",
    production = false,
    chosen = false;
  for (const flag of argv) {
    if (flag === "--dry-run" || flag === "--verify") {
      if (chosen) throw new FlagError("Choose one of --dry-run and --verify.");
      mode = flag === "--dry-run" ? "dry-run" : "verify";
      chosen = true;
    } else if (flag === "--production") production = true;
    else throw new FlagError(`Unknown flag ${flag}.`);
  }
  return { mode, production };
}
/** One line of the report: a document kind, the table it becomes, and the counts. */
export type KindReport = {
  kind: string;
  table: string;
  documents: number;
  rows: number;
  written: number;
};
export type MigrateReport = {
  mode: Mode;
  kinds: KindReport[];
  mismatches: string[];
};
type DocumentRow = { id: string; payload: unknown };
async function documentIds(kind: string): Promise<string[]> {
  return (
    (await database
      .prepare("SELECT id FROM yi_documents WHERE kind=$1 ORDER BY id")
      .all(kind)) as Record<string, unknown>[]
  ).map((r) => String(r.id));
}
async function document(kind: string, id: string): Promise<DocumentRow | null> {
  const r = (await database
    .prepare("SELECT id,payload FROM yi_documents WHERE kind=$1 AND id=$2")
    .get(kind, id)) as Record<string, unknown> | undefined;
  return r ? { id: String(r.id), payload: json(r.payload) } : null;
}
/**
 * The completed analyses whose claims and mentions become rows. Runs with an
 * input.task are the lab's side jobs — briefings, audio reviews, entity
 * classification — and carry no claims. Experiments are included, exactly as
 * the publish stage includes them: the run id and config hash on each row are
 * what a query filters on later.
 */
async function completedRunIds(): Promise<string[]> {
  return (
    (await database
      .prepare(
        "SELECT id FROM yi_runs WHERE status='completed' AND COALESCE(input::jsonb->>'task','')='' ORDER BY created_at,id",
      )
      .all()) as Record<string, unknown>[]
  ).map((r) => String(r.id));
}
/**
 * How many rows a table gained. An upsert reports that it touched a row
 * whether it inserted or refreshed one, so what "written" means here is
 * measured rather than counted: the rows present afterwards, minus the rows
 * present before. A second run therefore reports zero, which is the whole
 * claim this script makes about being idempotent.
 */
async function gained<T>(count: () => Promise<number>, work: () => Promise<T>) {
  const before = await count();
  const result = await work();
  return { result, written: (await count()) - before };
}
/** The channel documents channels.ts writes become `channels` rows. */
async function migrateChannels(write: boolean): Promise<KindReport> {
  const ids = await documentIds("channel");
  const { result: rows, written } = await gained(countChannels, async () => {
    let rows = 0;
    for (const id of ids) {
      const stored = await document("channel", id);
      if (!stored?.payload) continue;
      rows += 1;
      if (write) await upsertChannelRow(stored.payload as ChannelDocument);
    }
    return rows;
  });
  return { kind: "channel", table: "channels", documents: ids.length, rows, written };
}
/**
 * A managedCaption document becomes one immutable `transcripts` row with
 * kind='caption'. The document id is already (provider, mode, video, language),
 * so it is the row id too and a repeated run inserts nothing.
 */
async function migrateCaptions(write: boolean): Promise<KindReport> {
  const ids = await documentIds("managedCaption");
  const { result: rows, written } = await gained(
    () => countTranscripts("caption"),
    async () => {
      let rows = 0;
      for (const id of ids) {
        const stored = await document("managedCaption", id);
        const payload = stored?.payload as
          | {
              source?: { segments?: unknown; language?: unknown };
              provider?: unknown;
              at?: unknown;
            }
          | undefined;
        if (!payload?.source?.segments) continue;
        rows += 1;
        if (!write) continue;
        await insertTranscript({
          id,
          videoId: id.split(":")[2] ?? "",
          kind: "caption",
          provider:
            payload.provider === undefined ? null : String(payload.provider),
          language:
            payload.source.language === undefined
              ? null
              : String(payload.source.language),
          hash: createHash("sha256")
            .update(JSON.stringify(payload.source.segments))
            .digest("hex"),
          segments: payload.source.segments,
          createdAt: iso(payload.at) ?? undefined,
        });
      }
      return rows;
    },
  );
  return {
    kind: "managedCaption",
    table: "transcripts",
    documents: ids.length,
    rows,
    written,
  };
}
/** Accepted claims, their evidence spans and kept mentions, run by run. */
async function migrateRuns(write: boolean) {
  const ids = await completedRunIds();
  const before = {
    claims: await countClaims(),
    spans: await countEvidenceSpans(),
    mentions: await countMentions(),
  };
  const totals = { claims: 0, spans: 0, mentions: 0 };
  for (const id of ids) {
    const run = await get(id);
    if (!run) continue;
    const rows = rowsForRun(run);
    totals.claims += rows.claims.length;
    totals.spans += rows.spans.length;
    totals.mentions += rows.mentions.length;
    if (write) await writeRunRows(rows);
  }
  return {
    runs: ids.length,
    ...totals,
    writtenClaims: (await countClaims()) - before.claims,
    writtenSpans: (await countEvidenceSpans()) - before.spans,
    writtenMentions: (await countMentions()) - before.mentions,
  };
}
/**
 * Read everything, write rows unless this is a dry run. Nothing is deleted in
 * either mode.
 */
export async function migrateDocuments(
  options: MigrateOptions,
): Promise<MigrateReport> {
  const write = options.mode === "migrate";
  const kinds: KindReport[] = [
    await migrateChannels(write),
    await migrateCaptions(write),
  ];
  const runs = await migrateRuns(write);
  kinds.push(
    {
      kind: "run.claims",
      table: "claims",
      documents: runs.runs,
      rows: runs.claims,
      written: runs.writtenClaims,
    },
    {
      kind: "run.evidence",
      table: "evidence_spans",
      documents: runs.runs,
      rows: runs.spans,
      written: runs.writtenSpans,
    },
    {
      kind: "run.mentions",
      table: "mentions",
      documents: runs.runs,
      rows: runs.mentions,
      written: runs.writtenMentions,
    },
  );
  return { mode: options.mode, kinds, mismatches: [] };
}
/**
 * Count what is stored against what was written. Any difference is a mismatch
 * and names its kind: a row short means the migration did not finish, a row
 * over means something wrote a row the documents do not account for.
 */
export async function verifyDocuments(): Promise<MigrateReport> {
  const planned = await migrateDocuments({ mode: "dry-run", production: true });
  const actual: Record<string, number> = {
    channels: await countChannels(),
    transcripts: await countTranscripts("caption"),
    claims: await countClaims(),
    evidence_spans: await countEvidenceSpans(),
    mentions: await countMentions(),
  };
  const kinds = planned.kinds.map((k) => ({ ...k, written: actual[k.table] ?? 0 }));
  const mismatches = kinds
    .filter((k) => k.rows !== k.written)
    .map(
      (k) =>
        `${k.kind}: ${k.rows} expected in ${k.table}, ${k.written} present.`,
    );
  return { mode: "verify", kinds, mismatches };
}
/** 0 when everything lined up, 1 on any mismatch. What main() exits with. */
export function exitCodeFor(report: MigrateReport) {
  return report.mismatches.length ? 1 : 0;
}
export function formatReport(report: MigrateReport) {
  const header =
    report.mode === "dry-run"
      ? "Dry run. Nothing was written."
      : report.mode === "verify"
        ? "Verification."
        : "Migration complete. No source document was deleted.";
  const column = report.mode === "verify" ? "present" : "written";
  const lines = report.kinds.map(
    (k) =>
      `  ${k.kind.padEnd(16)} ${String(k.documents).padStart(6)} read  ${String(k.rows).padStart(6)} rows  ${String(k.written).padStart(6)} ${column}  -> ${k.table}`,
  );
  return [header, ...lines, ...report.mismatches.map((m) => `  MISMATCH ${m}`)].join(
    "\n",
  );
}
async function main() {
  let options: MigrateOptions;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof FlagError)) throw e;
    console.error(`scripts/migrate-documents.ts: ${e.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  // A maintenance script takes the direct endpoint, chosen here rather than by
  // the shell line that starts it.
  useDirectConnection();
  // Every run but the declared production one must prove its target is
  // disposable. Rehearse on a Neon branch before --production.
  if (!options.production)
    assertIsolatedDatabase("scripts/migrate-documents.ts");
  try {
    const report =
      options.mode === "verify"
        ? await verifyDocuments()
        : await migrateDocuments(options);
    console.log(formatReport(report));
    process.exitCode = exitCodeFor(report);
  } finally {
    await database.close();
  }
}
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
