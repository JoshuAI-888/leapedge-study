/**
 * What a backup contains.
 *
 * One list, read by both scripts/export-research.ts and
 * scripts/restore-research.ts, because two copies of it drift: the relational
 * tables (F24, F28) were added to the schema while the two scripts still named
 * only the nine document-era tables, so a channel's tier, seed sources, follow
 * time and polling cursor lived in a table no backup touched. Before that they
 * had been `channel` documents in yi_documents, which was exported.
 *
 * tests/backup.test.ts compares this list against the tables the migrations
 * actually create, so the next table added to the schema fails a test rather
 * than being quietly left out of the backup.
 */
export const BACKUP_VERSION = 4;
/**
 * The runner's own ledger. It is rebuilt by `npm run migrate` on the restore
 * target before any rows go in, and restoring one database's ledger into
 * another would claim migrations had been applied to a schema that never saw
 * them. Provider permits are ephemeral live leases and must never be restored.
 */
export const NOT_BACKED_UP = ["yi_migrations", "yi_provider_slots"];
export const BACKUP_TABLES = [
  "yi_runs",
  "yi_calls",
  "yi_responses",
  "yi_heartbeat",
  "yi_documents",
  "yi_events",
  "yi_prompts",
  "yi_discoveries",
  "yi_shares",
  "channels",
  "claims",
  "mentions",
  "evidence_spans",
  "transcripts",
  "reviews",
  "instruments",
  "jobs",
  "prices",
  "settlements",
  "price_history",
  "yi_stage_timings",
];
/**
 * The tables a version-1 backup carries. Such a file was written before the
 * relational tables existed, so a restore of one leaves them empty — which is
 * what that database held — rather than failing on tables the file could not
 * have contained.
 */
export const BACKUP_V1_TABLES = BACKUP_TABLES.slice(0, 9);
export const BACKUP_V3_TABLES = BACKUP_TABLES.filter((t) => t !== "yi_stage_timings");
export const BACKUP_V2_TABLES = BACKUP_V3_TABLES.filter(
  (t) => t !== "price_history",
);
export function tablesFor(version: number): string[] {
  if (version === 1) return BACKUP_V1_TABLES;
  if (version === 2) return BACKUP_V2_TABLES;
  if (version === 3) return BACKUP_V3_TABLES;
  if (version === BACKUP_VERSION) return BACKUP_TABLES;
  throw Error(
    `Backup version ${version} is not one this build can restore (1, 2, 3 or ${BACKUP_VERSION}).`,
  );
}
