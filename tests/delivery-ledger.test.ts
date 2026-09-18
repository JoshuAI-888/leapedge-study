import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

/**
 * The ledger is the single source of truth for where delivery stands, and this
 * file is what stops it becoming another stale document.
 *
 * It exists because the build plan's own prose went unchecked: twenty-one
 * commits of finished phase-2 work sat on a branch nobody tracked, phase 2
 * opened while both earlier gates were advisory, and two test files the plan
 * names were never written. Each of those is a plan-versus-reality gap, and
 * each is machine-checkable. Anything the plan asserts, a test should assert.
 */

const PHASES = [0, 1, 2, 3, 4] as const;
const Feature = z.object({
  id: z.string().regex(/^[FG]\d{2}[a-z]?$/),
  phase: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  lane: z.string().min(1),
  title: z.string().min(10),
  spec: z.string().min(1),
  status: z.enum(["merged", "in-review", "todo", "removed"]),
  planned: z.boolean(),
  prereqs: z.array(z.string()),
  files: z.array(z.string()),
  tests: z.array(z.string()),
  pr: z.number().int().positive().optional(),
  note: z.string().min(10).optional(),
});
const Ledger = z.object({
  version: z.literal("delivery-ledger.v1"),
  updated: z.iso.date(),
  source: z.string(),
  readMeFirst: z.string().min(1),
  statusMeaning: z.record(z.string(), z.string()),
  features: z.array(Feature).min(1),
});

const ledger = Ledger.parse(
  JSON.parse(readFileSync("docs/delivery/ledger.json", "utf8")),
);
const features = ledger.features;
const byId = new Map(features.map((f) => [f.id, f]));

test("The ledger parses, ids are unique, and every status is documented", () => {
  assert.equal(byId.size, features.length, "duplicate feature id");
  for (const f of features) {
    assert.ok(
      ledger.statusMeaning[f.status],
      `status "${f.status}" (${f.id}) has no entry in statusMeaning`,
    );
    if (f.phase !== null)
      assert.ok(PHASES.includes(f.phase), `${f.id} has an unknown phase`);
  }
});

test("Every prerequisite names a feature that exists", () => {
  for (const f of features)
    for (const p of f.prereqs)
      assert.ok(byId.has(p), `${f.id} requires ${p}, which is not in the ledger`);
});

test("A merged feature's files and tests are all on disk", () => {
  // This is what a stale "done" looks like from the outside, so it is the
  // check that catches one.
  for (const f of features) {
    if (f.status !== "merged") continue;
    for (const path of [...f.files, ...f.tests])
      assert.ok(existsSync(path), `${f.id} is merged but ${path} does not exist`);
  }
});

test("Every named test file is one npm test actually runs", () => {
  // package.json globs tests/*.test.ts, so a test in a subdirectory or under
  // another name is a test that never runs and therefore never guards anything.
  const glob = /^tests\/[^/]+\.test\.ts$/;
  for (const f of features)
    for (const path of f.tests)
      assert.match(
        path,
        glob,
        `${f.id} names ${path}, which the tests/*.test.ts glob does not pick up`,
      );
});

test("Nothing is merged ahead of its prerequisites", () => {
  // The rule the build plan states in prose: a phase's lanes open only after
  // the phase before it closes. Phase 2 opened while phases 0 and 1 were still
  // advisory; this is the assertion that would have said so.
  const rank = { todo: 0, "in-review": 1, merged: 2, removed: 3 } as const;
  for (const f of features) {
    if (f.status === "removed" || f.status === "todo") continue;
    for (const p of f.prereqs) {
      const prereq = byId.get(p)!;
      if (prereq.status === "removed") continue;
      assert.ok(
        rank[prereq.status] >= rank[f.status],
        `${f.id} is ${f.status} but its prerequisite ${p} is only ${prereq.status}`,
      );
    }
  }
});

test("An in-review feature names its pull request, and a removed one says why", () => {
  for (const f of features) {
    if (f.status === "in-review")
      assert.ok(f.pr, `${f.id} is in review but names no pull request`);
    if (f.status === "removed")
      assert.ok(f.note, `${f.id} was removed without recording why`);
  }
});

test("No feature is still todo once everything it promises exists", () => {
  // The twenty-one-commit blind spot in one assertion: work that landed
  // without the ledger being updated shows up here as a todo whose files and
  // tests are all present.
  for (const f of features) {
    if (f.status !== "todo") continue;
    const paths = [...f.files, ...f.tests];
    if (paths.length === 0) continue;
    assert.ok(
      !paths.every((p) => existsSync(p)),
      `${f.id} is marked todo but every file and test it names already exists; the ledger is behind the code`,
    );
  }
});

test("Every feature the build plan lists is in the ledger", () => {
  // The plan and the ledger cannot drift apart silently: a feature added to
  // one has to be added to the other.
  const plan = readFileSync(ledger.source, "utf8");
  const planned = new Set(
    [...plan.matchAll(/^\|\s*(F\d{2}[a-z]?)\s*\|/gm)].map((m) => m[1]),
  );
  assert.ok(planned.size > 40, "the build plan tables did not parse as expected");
  for (const id of planned)
    assert.ok(byId.has(id), `${id} is in ${ledger.source} but not in the ledger`);
  // The reverse direction allows extras, but they must be marked as such.
  for (const f of features)
    if (f.planned)
      assert.ok(
        planned.has(f.id),
        `${f.id} claims to be planned but ${ledger.source} does not list it`,
      );
});

test("The delivery position the ledger reports is the one to quote", () => {
  // Not an assertion about a number, which would just be a second place to
  // keep it. It asserts the shape of the answer is computable at all, and
  // prints it, so a session that reads one file knows where the project is.
  const counted = features.filter((f) => f.status !== "removed");
  const merged = counted.filter((f) => f.status === "merged");
  const review = counted.filter((f) => f.status === "in-review");
  const todo = counted.filter((f) => f.status === "todo");
  assert.equal(merged.length + review.length + todo.length, counted.length);
  assert.ok(todo.length > 0, "nothing left to do; close the ledger out");
  console.log(
    `  delivery: ${merged.length} merged, ${review.length} in review, ${todo.length} to do, of ${counted.length} active`,
  );
  for (const phase of PHASES) {
    const inPhase = counted.filter((f) => f.phase === phase);
    const done = inPhase.filter((f) => f.status === "merged").length;
    console.log(`  phase ${phase}: ${done}/${inPhase.length} merged`);
  }
});
