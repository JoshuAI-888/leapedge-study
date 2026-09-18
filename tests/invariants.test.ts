import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { freshDatabase } from "./helpers/db.ts";
import * as store from "../src/server/youtube-intelligence/store.ts";
import { registry } from "../src/features/youtube-intelligence/metrics/registry.ts";
import { uiColumns } from "../src/features/youtube-intelligence/metrics/ui-columns.ts";
import {
  deriveEvidence,
  Source,
} from "../src/features/youtube-intelligence/contracts.ts";
import { createHash } from "node:crypto";

/**
 * The system invariants from build plan section 4, as seeded property tests
 * over the fake transport and a PGlite database.
 *
 * These are properties that must hold for *any* sequence of events, not for one
 * scripted path, which is why they are here rather than in a feature's own
 * test. They are also the quality floor while the promotion gate is advisory:
 * with no verified gold set (docs/gates/gate-debt.md), tests are the only thing
 * standing between a change and the truth.
 *
 * Four of the eight invariants need tables phase 2 introduces. They are not
 * quietly absent: the last test asserts they are still unreachable, and fails
 * the moment the feature lands without its invariant being written.
 */

/** A deterministic PRNG, so a failure is a failure you can re-run. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const SEEDS = [1, 7, 42, 1009, 65537];

// --- Invariant 1 ------------------------------------------------------------

test("Invariant 1: retries never double-spend, for any sequence of outcomes", async () => {
  // A stage may be attempted several times. Whatever mixture of success,
  // retryable failure and unknown outcome occurs, the money the ledger counts
  // for that stage is one settled amount, never the sum of every attempt.
  for (const seed of SEEDS) {
    await freshDatabase();
    process.env.YTI_BUDGET_USD = "1000";
    const random = rng(seed);
    const run = await store.create(`vid-${seed}`, "fake/model", { seed }, "v1");
    const stage = "extraction";
    let attempt = 0;
    let settled: number | null = null;
    let open = false;

    for (let step = 0; step < 12; step++) {
      if (!open) {
        attempt += 1;
        const id = await store.reserve(run.id, stage, 0.01 + random() * 0.05, attempt);
        open = true;
        const draw = random();
        if (draw < 0.4) {
          await store.release(id, "retryable failure");
          open = false;
        } else if (draw < 0.6) {
          await store.settle(id, null, { attempt });
          await store.markUnknown(id, "no status from the provider");
          // An unknown outcome stays open on purpose: reconcile.ts owns it.
          break;
        } else {
          const cost = 0.002 + random() * 0.02;
          await store.settle(id, cost, { attempt });
          settled = cost;
          open = false;
          break;
        }
      }
    }

    const attempts = await store.listAttempts(run.id, stage);
    const completed = attempts.filter((a) => a.status === "completed");
    assert.ok(
      completed.length <= 1,
      `seed ${seed}: ${completed.length} completed attempts for one stage`,
    );
    if (settled !== null) {
      assert.equal(completed.length, 1, `seed ${seed}: the settled attempt is missing`);
      assert.equal(completed[0]!.amount, settled, `seed ${seed}: settled amount changed`);
    }
    // Released attempts hold nothing, so they cannot contribute to the run cost.
    for (const a of attempts)
      if (a.status === "released")
        assert.equal(a.amount, 0, `seed ${seed}: a released attempt still holds money`);
    // Attempt numbers are dense and increasing: one row per try, never two open.
    assert.deepEqual(
      attempts.map((a) => a.attempt),
      attempts.map((_, i) => i + 1),
      `seed ${seed}: attempt numbering is not one row per try`,
    );
    assert.ok(
      attempts.filter((a) => a.open).length <= 1,
      `seed ${seed}: more than one attempt is open at once`,
    );
  }
});

test("Invariant 1: reserve refuses a second open attempt for the same stage", async () => {
  await freshDatabase();
  process.env.YTI_BUDGET_USD = "1000";
  const run = await store.create("vid-open", "fake/model", {}, "v1");
  await store.reserve(run.id, "extraction", 0.05, 1);
  await assert.rejects(
    () => store.reserve(run.id, "extraction", 0.05, 2),
    /still open/,
    "a second attempt opened while the first was unresolved",
  );
});

// --- Invariant 2 ------------------------------------------------------------

test("Invariant 2: excess is never stored", async () => {
  // Spec 4.11: every number is computed when it is requested. An excess column
  // would be a benchmark comparison frozen into a row, which is the thing this
  // product exists not to do.
  const db = await freshDatabase();
  const columns = (await db
    .prepare(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'",
    )
    .all()) as { table_name: string; column_name: string }[];
  assert.ok(columns.length > 0, "the schema did not apply");
  for (const c of columns)
    assert.ok(
      !/excess/i.test(c.column_name),
      `${c.table_name}.${c.column_name} stores an excess figure; compute it at query time instead`,
    );
});

// --- Invariant 3 ------------------------------------------------------------

test("Invariant 3: every UI column maps to a registry id", () => {
  // Also asserted by tests/metrics-registry.test.ts against the fixture
  // database. Repeated here because it is an invariant of the product, not a
  // property of one feature's test.
  const ids = new Set(registry.map((entry) => entry.id));
  for (const column of uiColumns)
    assert.ok(
      ids.has(column.metricId),
      `${column.surface} / ${column.column} points at "${column.metricId}", which the registry does not define`,
    );
});

// --- Invariant 7 ------------------------------------------------------------

test("Invariant 7: every evidence pointer resolves to text the source really contains", () => {
  // Spec 4.2: the model returns a range, the application copies the words. For
  // any range the application accepts, the copied text must be exactly what
  // lies between those segments and the hash must be the hash of that text.
  // Otherwise provenance is asserted rather than proven, which is the failure
  // pointer evidence exists to make impossible.
  for (const seed of SEEDS) {
    const random = rng(seed);
    const count = 6 + Math.floor(random() * 6);
    const source = Source.parse({
      source_kind: "native_captions_transcriptapi",
      segments: Array.from({ length: count }, (_, i) => ({
        id: `s${i}`,
        text: `segment ${i} says ${Math.floor(random() * 1000)}. `,
        // One second apart, so no range can exceed the two-minute limit.
        start_seconds: i,
        end_seconds: i + 1,
      })),
    });
    const separator = source.segment_separator || "";

    for (let trial = 0; trial < 20; trial++) {
      const start = Math.floor(random() * count);
      const end = start + Math.floor(random() * (count - start));
      const derived = deriveEvidence(source, {
        start_id: `s${start}`,
        end_id: `s${end}`,
      });
      const expected = source.segments
        .slice(start, end + 1)
        .map((segment) => segment.text)
        .join(separator);
      assert.equal(
        derived.quote_original,
        expected,
        `seed ${seed}: the copied evidence is not the text the range names`,
      );
      assert.equal(
        derived.text_hash,
        createHash("sha256").update(expected).digest("hex"),
        `seed ${seed}: the hash does not describe the copied text`,
      );
      assert.equal(derived.start_seconds, source.segments[start]!.start_seconds);
      assert.equal(derived.end_seconds, source.segments[end]!.end_seconds);

      // The rejection side of the same invariant: a range the source cannot
      // resolve is never silently turned into some other range's text.
      if (end > start)
        assert.throws(
          () => deriveEvidence(source, { start_id: `s${end}`, end_id: `s${start}` }),
          `seed ${seed}: a reversed range was accepted`,
        );
      assert.throws(
        () => deriveEvidence(source, { start_id: `s${start}`, end_id: "no-such-id" }),
        `seed ${seed}: a range naming an unknown segment was accepted`,
      );
    }
  }
});

// --- The four that phase 2 unlocks -----------------------------------------

/**
 * Invariants 4, 5, 6 and 8 need tables and modules that do not exist yet. Each
 * entry names what must appear before the invariant becomes writable. When one
 * does appear, this test fails, and the fix is to write the invariant above and
 * remove the entry — not to delete the check.
 */
const PENDING: { invariant: string; feature: string; unlockedBy: string }[] = [
  {
    invariant: "4: trust is monotonic; only an append to reviews reaches L3",
    feature: "F35",
    unlockedBy: "src/features/youtube-intelligence/trust.ts",
  },
  {
    invariant: "5: settlements, reviews and transcripts are append-only",
    feature: "F25",
    unlockedBy: "src/server/youtube-intelligence/settlement.ts",
  },
  {
    invariant: "6: every context_checks source date lies inside its window",
    feature: "F50",
    unlockedBy: "src/server/youtube-intelligence/context-check.ts",
  },
  {
    invariant: "8: no reserved row outlives the hold window without a reconcile job",
    feature: "F26",
    unlockedBy: "src/server/youtube-intelligence/queue.ts",
  },
];

test("The invariants phase 2 and 3 unlock are written the moment they can be", () => {
  const arrived = PENDING.filter((p) => existsSync(p.unlockedBy));
  assert.deepEqual(
    arrived,
    [],
    `these features landed, so their invariants are now writable and must be written here:\n` +
      arrived
        .map((p) => `  ${p.feature} (${p.unlockedBy}) -> invariant ${p.invariant}`)
        .join("\n"),
  );
  // And the ledger must still agree that they are unbuilt, so the two files
  // cannot drift into disagreeing about what exists.
  const ledger = JSON.parse(readFileSync("docs/delivery/ledger.json", "utf8")) as {
    features: { id: string; status: string }[];
  };
  for (const pending of PENDING) {
    const entry = ledger.features.find((f) => f.id === pending.feature);
    assert.ok(entry, `${pending.feature} is not in the ledger`);
    assert.equal(
      entry!.status,
      "todo",
      `${pending.feature} is ${entry!.status} in the ledger but invariant ${pending.invariant} is still listed as pending here`,
    );
  }
});
