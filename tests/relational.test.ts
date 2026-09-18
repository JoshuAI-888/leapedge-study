import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { freshDatabase } from "./helpers/db.ts";
import { seedFixture } from "./helpers/fixtures.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import * as store from "../src/server/youtube-intelligence/store.ts";
import { step } from "../src/server/youtube-intelligence/pipeline.ts";
import {
  put,
  researchSnapshot,
} from "../src/server/youtube-intelligence/research-store.ts";
import { claimsForRun, countClaims, listClaims } from "../src/server/youtube-intelligence/repos/claims.ts";
import { mentionsForRun } from "../src/server/youtube-intelligence/repos/mentions.ts";
import {
  spansForClaim,
  countEvidenceSpans,
} from "../src/server/youtube-intelligence/repos/evidence-spans.ts";
import {
  insertTranscript,
  listTranscripts,
  segmentsFor,
  countTranscripts,
  PROJECTION,
} from "../src/server/youtube-intelligence/repos/transcripts.ts";
import { countChannels, listChannels } from "../src/server/youtube-intelligence/repos/channels.ts";
import {
  getInstrument,
  upsertInstrument,
} from "../src/server/youtube-intelligence/repos/instruments.ts";
import {
  exitCodeFor,
  formatReport,
  migrateDocuments,
  parseOptions,
  verifyDocuments,
  FlagError,
} from "../scripts/migrate-documents.ts";
import type { Run } from "../src/features/youtube-intelligence/contracts.ts";
/** Re-enter the publish stage of an already completed fixture run. */
async function publish(id: string) {
  const run = (await store.get(id))!;
  run.stage = "publish";
  run.status = "running";
  await step(run);
  return run;
}
/**
 * Empty the relational tables, so a fixture-seeded database looks like one that
 * has not been migrated yet. seedFixture() writes through put(), which mirrors
 * a channel document into its row, so a migration test has to take the rows
 * back out first.
 */
async function clearRows(
  tables = ["claims", "mentions", "evidence_spans", "transcripts", "channels"],
) {
  for (const table of tables)
    await database.prepare(`DELETE FROM ${table}`).run();
}
const CLAIM_TABLES = ["claims", "mentions", "evidence_spans"];
const CAPTION_ID = "supadata:native:aB1cD2eF3gH:en";
async function seedCaption() {
  await put("managedCaption", CAPTION_ID, {
    provider: "supadata",
    mode: "native",
    at: "2026-06-02T03:00:00.000Z",
    source: {
      video_id: "aB1cD2eF3gH",
      language: "en",
      source_kind: "managed_caption",
      segments: [
        { id: "s1", text: "A caption segment.", start_seconds: 0, end_seconds: 4 },
      ],
    },
  });
}

test("The publish stage writes claim, evidence and mention rows for a fixture run", async () => {
  await freshDatabase();
  const seeded = await seedFixture("baseline");
  const runId = seeded.runs["mike-nvda-earnings"];
  await clearRows();
  const run = await publish(runId);
  assert.equal(run.status, "completed");
  const claims = await claimsForRun(runId);
  // Two claims on this run, both accepted; a rejected claim never becomes a row.
  assert.deepEqual(
    claims.map((c) => c.ticker).sort(),
    ["NVDA", "SPY"],
  );
  const nvda = claims.find((c) => c.ticker === "NVDA")!;
  assert.equal(nvda.id, `${runId}:c1`);
  assert.equal(nvda.videoId, "aB1cD2eF3gH");
  assert.equal(nvda.channelId, "UCmacroMike0000000000001");
  assert.equal(nvda.stance, "long");
  assert.equal(nvda.creatorConviction, "high");
  assert.equal(nvda.trustLevel, "L0");
  assert.equal(nvda.publishedAt, "2026-06-01T15:00:00.000Z");
  assert.match(nvda.configHash!, /^[0-9a-f]{64}$/);
  assert.deepEqual((nvda.trustBasis as { structural: boolean }).structural, true);
  const spans = await spansForClaim(nvda.id);
  assert.equal(spans.length, 2, "one row per cited range, in the claim's order");
  assert.deepEqual(
    spans.map((s) => s.ordinal),
    [0, 1],
  );
  assert.equal(spans[0].startId, "s1");
  assert.match(spans[0].textHash!, /^[0-9a-f]{64}$/);
  assert.equal(spans[0].startSeconds, 12, "seconds come from the retained source");
  // A second pass through publish writes the same rows, not a second set.
  await publish(runId);
  assert.equal((await claimsForRun(runId)).length, 2);
  assert.equal((await spansForClaim(nvda.id)).length, 2);
});

test("Publish maps mentions onto rows and links only the claims it published", async () => {
  await freshDatabase();
  const seeded = await seedFixture("baseline");
  const runId = seeded.runs["mike-nvda-earnings"];
  const run = (await store.get(runId))!;
  run.output.mentions = [
    {
      ticker: "NVDA",
      instrument_as_spoken: "Nvidia",
      market: "us-stock",
      stance: "long",
      sentiment: "bullish",
      rationale_en: "The creator is adding to the position.",
      source_span: {
        start_id: "s1",
        end_id: "s1",
        start_seconds: 12,
        end_seconds: 17,
        text_hash: "a".repeat(64),
      },
      is_call: true,
      claim_id: "c1",
    },
    {
      ticker: "AMD",
      instrument_as_spoken: "AMD",
      market: "us-stock",
      stance: "watch",
      sentiment: "neutral",
      rationale_en: "Mentioned only as a comparison.",
      source_span: {
        start_id: "s3",
        end_id: "s3",
        start_seconds: 40,
        end_seconds: 46,
        text_hash: "b".repeat(64),
      },
      is_call: false,
      claim_id: null,
    },
  ];
  run.stage = "publish";
  run.status = "running";
  await clearRows();
  await step(run);
  const mentions = await mentionsForRun(runId);
  assert.equal(mentions.length, 2);
  const [call, aside] = mentions;
  // The positional index is zero-padded: the id is also the sort key, and the
  // table keeps no ordinal, so `m10` has to follow `m9` rather than `m1`.
  assert.equal(call.id, `${runId}:m0001`);
  assert.equal(aside.id, `${runId}:m0002`);
  assert.equal(call.sentiment, "bullish");
  assert.equal(call.isCall, true);
  assert.equal(call.claimId, `${runId}:c1`, "a call points at its claim row");
  assert.equal(call.spanId, "s1");
  assert.equal(aside.claimId, null);
  assert.equal(aside.sentiment, "neutral");
});

test("A republished run takes back the rows its new pass no longer produces", async () => {
  await freshDatabase();
  const seeded = await seedFixture("baseline");
  const runId = seeded.runs["mike-nvda-earnings"];
  const run = (await store.get(runId))!;
  const mention = {
    instrument_as_spoken: "Nvidia",
    market: "us-stock",
    stance: "long",
    sentiment: "bullish",
    rationale_en: "The creator is adding to the position.",
    is_call: false,
    claim_id: null,
  };
  run.output.mentions = [
    { ...mention, ticker: "NVDA" },
    { ...mention, ticker: "AMD" },
  ];
  await clearRows();
  run.stage = "publish";
  run.status = "running";
  await step(run);
  assert.deepEqual(
    (await claimsForRun(runId)).map((c) => c.ticker).sort(),
    ["NVDA", "SPY"],
  );
  const spy = (await claimsForRun(runId)).find((c) => c.ticker === "SPY")!;
  assert.ok((await spansForClaim(spy.id)).length > 0);
  // A re-critique rejects the SPY claim and the run keeps one mention fewer.
  // The record is what the run says now, not the union of both passes.
  const claims = run.output.claims as {
    passed: boolean;
    claim: { ticker: string | null };
  }[];
  claims.find((c) => c.claim.ticker === "SPY")!.passed = false;
  run.output.mentions = [{ ...mention, ticker: "NVDA" }];
  run.stage = "publish";
  run.status = "running";
  await step(run);
  assert.deepEqual(
    (await claimsForRun(runId)).map((c) => c.ticker),
    ["NVDA"],
    "the rejected claim's row is gone",
  );
  assert.deepEqual(await spansForClaim(spy.id), [], "and so are its spans");
  assert.deepEqual(
    (await mentionsForRun(runId)).map((m) => m.ticker),
    ["NVDA"],
    "the dropped mention's row is gone",
  );
  // A claim that survives but cites fewer ranges than before. Its spans are
  // keyed by ordinal, so the ones past the new last ordinal are never
  // overwritten and have to be deleted outright. Without this pass, every
  // assertion above still holds: the whole-claim delete covers a claim that
  // disappears, not one that keeps its row and sheds evidence.
  const nvda = (await claimsForRun(runId)).find((c) => c.ticker === "NVDA")!;
  const before = (await spansForClaim(nvda.id)).map((s) => s.ordinal);
  assert.ok(before.length > 1, "the fixture claim cites more than one range");
  const kept = claims.find((c) => c.claim.ticker === "NVDA")!.claim as unknown as {
    evidence: unknown[];
  };
  kept.evidence = kept.evidence.slice(0, before.length - 1);
  run.stage = "publish";
  run.status = "running";
  await step(run);
  assert.deepEqual(
    (await spansForClaim(nvda.id)).map((s) => s.ordinal),
    before.slice(0, -1),
    "the span past the new last ordinal is deleted, not left behind",
  );
});

test("researchSnapshot reads claims, mentions and channels from rows", async () => {
  await freshDatabase();
  const seeded = await seedFixture("baseline");
  await clearRows(CLAIM_TABLES);
  for (const id of Object.values(seeded.runs)) await publish(id);
  const snapshot = await researchSnapshot();
  // The five accepted claims across the three fixture runs, the same set
  // accepted() reads off the runs themselves.
  const fromRuns = (await store.list()).flatMap((r: Run) =>
    ((r.output.claims || []) as { id: string; passed: boolean }[])
      .filter((c) => c.passed)
      .map((c) => `${r.id}:${c.id}`),
  );
  assert.equal(fromRuns.length, 5);
  assert.deepEqual(
    snapshot.claims.map((c) => c.id).sort(),
    fromRuns.sort(),
  );
  assert.deepEqual(
    snapshot.claims.map((c) => c.ticker).filter(Boolean).sort(),
    ["AAPL", "NVDA", "NVDA", "SPY", "TSLA"],
  );
  assert.deepEqual(snapshot.mentions, []);
  // Channels come from the table, and carry the polling state the surface reads.
  assert.equal(snapshot.channels.length, 2);
  const mike = snapshot.channels.find((c) => c.id === "UCmacroMike0000000000001")!;
  assert.equal(mike.title, "Macro Mike");
  assert.equal(mike.handle, "@macromike");
  assert.equal(mike.active, true);
  assert.equal(mike.favorite, true);
  assert.equal(mike.autoAnalyze, true);
  assert.equal(mike.uploads, "UUmacroMike0000000000001");
});

test("A list query over transcripts never selects the text column", async () => {
  await freshDatabase();
  const segments = Array.from({ length: 2000 }, (_, i) => ({
    id: `s${i + 1}`,
    text: "x".repeat(200),
    start_seconds: i,
    end_seconds: i + 1,
  }));
  await insertTranscript({
    id: "supadata:native:aB1cD2eF3gH:en",
    videoId: "aB1cD2eF3gH",
    kind: "caption",
    provider: "supadata",
    language: "en",
    hash: "c".repeat(64),
    segments,
  });
  // Assert on the column list itself. The converter below builds a fixed
  // object, so a listing looks the same whether or not the query selected the
  // text: without this line, putting `segments` back into PROJECTION leaves
  // every assertion in this test green.
  assert.equal(
    PROJECTION.split(",").includes("segments"),
    false,
    "the list projection must not name the text column",
  );
  const rows = await listTranscripts();
  assert.equal(rows.length, 1);
  assert.equal("segments" in rows[0], false, "the projection leaves the text out");
  assert.ok(
    JSON.stringify(rows).length < 1000,
    "a listing stays small however long the transcript is",
  );
  const text = (await segmentsFor("supadata:native:aB1cD2eF3gH:en")) as unknown[];
  assert.equal(text.length, 2000, "the text is reachable one row at a time");
  // The same rule as source: nothing but segmentsFor() may read the column.
  const offences: string[] = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.tsx?$/.test(entry.name)) {
        const body = await readFile(path, "utf8");
        for (const m of body.matchAll(/"((?:[^"\\\n]|\\.)*)"|`([^`]*)`/g)) {
          const sql = m[1] ?? m[2] ?? "";
          if (!/FROM transcripts/.test(sql)) continue;
          if (/SELECT \*/.test(sql))
            offences.push(`${path}: SELECT * on transcripts`);
          if (/segments/.test(sql) && !/WHERE id=\$1/.test(sql))
            offences.push(`${path}: a list query selects transcripts.segments`);
        }
      }
    }
  };
  await walk("src");
  await walk("scripts");
  assert.deepEqual(offences, []);
});

test("parseOptions accepts one mode and refuses two", () => {
  assert.deepEqual(parseOptions([]), { mode: "migrate", production: false });
  assert.deepEqual(parseOptions(["--dry-run"]), {
    mode: "dry-run",
    production: false,
  });
  assert.deepEqual(parseOptions(["--verify", "--production"]), {
    mode: "verify",
    production: true,
  });
  assert.throws(() => parseOptions(["--dry-run", "--verify"]), FlagError);
  assert.throws(() => parseOptions(["--wat"]), FlagError);
});

test("The document migration is idempotent, and --dry-run writes nothing", async () => {
  await freshDatabase();
  await seedFixture("baseline");
  await seedCaption();
  // A database as it is before the migration: documents and runs, no rows.
  await clearRows();
  const counts = async () => ({
    channels: await countChannels(),
    transcripts: await countTranscripts("caption"),
    claims: await countClaims(),
    spans: await countEvidenceSpans(),
  });
  assert.deepEqual(await counts(), {
    channels: 0,
    transcripts: 0,
    claims: 0,
    spans: 0,
  });
  const dry = await migrateDocuments({ mode: "dry-run", production: true });
  assert.deepEqual(await counts(), {
    channels: 0,
    transcripts: 0,
    claims: 0,
    spans: 0,
  });
  const planned = Object.fromEntries(dry.kinds.map((k) => [k.kind, k]));
  assert.equal(planned.channel.rows, 2);
  assert.equal(planned.channel.written, 0);
  assert.equal(planned.managedCaption.rows, 1);
  assert.equal(planned["run.claims"].rows, 5);
  assert.ok(planned["run.evidence"].rows >= 5);
  assert.match(formatReport(dry), /Dry run\. Nothing was written\./);
  const first = await migrateDocuments({ mode: "migrate", production: true });
  assert.deepEqual(await counts(), {
    channels: 2,
    transcripts: 1,
    claims: 5,
    spans: planned["run.evidence"].rows,
  });
  assert.equal(first.kinds.find((k) => k.kind === "channel")!.written, 2);
  assert.equal(first.kinds.find((k) => k.kind === "run.claims")!.written, 5);
  // Running it again is a no-op: every id derives from what it came from.
  const before = await counts();
  const second = await migrateDocuments({ mode: "migrate", production: true });
  assert.deepEqual(await counts(), before);
  for (const k of second.kinds) assert.equal(k.written, 0, `${k.kind} wrote again`);
  // Nothing was deleted: the source documents are still the restore point.
  const documents = (await database
    .prepare("SELECT COUNT(*) AS n FROM yi_documents WHERE kind=$1")
    .get("channel")) as { n: unknown };
  assert.equal(Number(documents.n), 2);
  const verified = await verifyDocuments();
  assert.deepEqual(verified.mismatches, []);
  assert.equal(exitCodeFor(verified), 0);
});

test("A resumed migration finishes what an interrupted one left, and --verify catches a missing row", async () => {
  await freshDatabase();
  await seedFixture("baseline");
  await seedCaption();
  await clearRows();
  await migrateDocuments({ mode: "migrate", production: true });
  // An interruption part-way leaves a prefix of the rows behind.
  const dropped = (await listClaims())[0];
  await database.prepare("DELETE FROM claims WHERE id=$1").run(dropped.id);
  const short = await verifyDocuments();
  assert.equal(exitCodeFor(short), 1);
  assert.equal(short.mismatches.length, 1);
  assert.match(short.mismatches[0], /^run\.claims: 5 expected in claims, 4 present\./);
  assert.match(formatReport(short), /MISMATCH run\.claims/);
  // Resuming writes exactly the row that was missing.
  const resumed = await migrateDocuments({ mode: "migrate", production: true });
  assert.equal(resumed.kinds.find((k) => k.kind === "run.claims")!.written, 1);
  assert.deepEqual((await verifyDocuments()).mismatches, []);
  // A channel row removed is named as its own kind.
  await database.prepare("DELETE FROM channels").run();
  const missing = await verifyDocuments();
  assert.equal(exitCodeFor(missing), 1);
  assert.ok(missing.mismatches.some((m) => m.startsWith("channel:")));
  assert.equal((await listChannels()).length, 0);
});

test("An instrument refresh keeps the verification it already has", async () => {
  await freshDatabase();
  const nvda = {
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    currency: "USD",
    exchange: "NASDAQ",
    market: "us-stock",
    verifiedAt: "2026-06-01T00:00:00.000Z",
  };
  await upsertInstrument(nvda);
  // A later lookup that resolves the symbol without verifying it must not
  // erase the timestamp, the same way it must not erase the market.
  await upsertInstrument({ ...nvda, market: null, verifiedAt: null });
  const row = (await getInstrument("NVDA"))!;
  assert.equal(row.verifiedAt, "2026-06-01T00:00:00.000Z");
  assert.equal(row.market, "us-stock");
});
