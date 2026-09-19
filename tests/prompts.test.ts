import { test } from "node:test";
import assert from "node:assert/strict";
process.env.YTI_DB = "pglite";
delete process.env.DATABASE_URL;
const R = await import("../src/server/youtube-intelligence/research-store.ts");
const S = await import("../src/server/youtube-intelligence/store.ts");
const { teamDefaults } =
  await import("../src/features/youtube-intelligence/settings.ts");
/**
 * The hash a prompt version had when it was published. A registry row is
 * immutable, so editing the text of a shipped version would silently change
 * what a past run claims to have used: these six are frozen on purpose and a
 * new version may never move them.
 */
const FROZEN_HASHES: Record<string, string> = {
  "evidence-first.web.v1":
    "bc39fcf886e73feb1266e65d9f327f710ef9d57a36129a9b63f9fb3ce9356dca",
  "evidence-first.web.v2":
    "2ad3b65ef4df8af223c01c7c61714195a687946db5c702ddbb6da79951642508",
  "evidence-first.web.v3":
    "5666a07925255786c03008ac8d2f737e81aef51ff7779b35610d6270b6216fd5",
  "evidence-first.web.v4":
    "caddf8ae73df366bc81d0e8f9b5e5677b6cd918fe732492d97acb60acc3cfd30",
  "evidence-first.web.v5":
    "3659a534418d264f5b7fafa02c4929a4691e7f9910377e5e001a22b48e56b7eb",
  "evidence-first.web.v6":
    "aa552a96126ce52f1bdf54e1656b29e51d82119aacc9d12fe0e80f4f406c3f70",
};
test("Prompt v7 carries the pointer flag through the registry and leaves every shipped hash alone", async () => {
  const versions = await R.promptVersions(),
    byId = new Map(
      versions.map((v: { id: string }) => [v.id, v as { id: string }]),
    );
  for (const [id, hash] of Object.entries(FROZEN_HASHES)) {
    const row = byId.get(id) as { hash?: string } | undefined;
    assert.ok(row, `${id} is missing from the registry`);
    assert.equal(row!.hash, hash, `${id} hash moved`);
  }
  const v7 = byId.get("evidence-first.web.v7") as
    { hash?: string; pointerEvidence?: boolean } | undefined;
  assert.ok(v7, "evidence-first.web.v7 is not seeded");
  assert.equal(v7!.pointerEvidence, true);
  assert.notEqual(v7!.hash, FROZEN_HASHES["evidence-first.web.v6"]);
  // The snapshot the pipeline reads is parsed through PromptVersion, so the
  // flag has to survive the schema as well as the row.
  const snapshot = (await R.prompt("evidence-first.web.v7")) as {
    pointerEvidence?: boolean;
  };
  assert.equal(snapshot.pointerEvidence, true);
  const v6 = (await R.prompt("evidence-first.web.v6")) as {
    pointerEvidence?: boolean;
  };
  assert.equal(v6.pointerEvidence, undefined);
  // The pipeline reads the flag off the snapshot the run was queued with, so
  // the flag has to arrive there for the copy path to switch on at all.
  const run = await R.queue("3u24qyWjSVM", undefined, {
    promptVersion: "evidence-first.web.v7",
  });
  assert.equal(
    (run.input.promptSnapshot as { pointerEvidence?: boolean }).pointerEvidence,
    true,
  );
});
test("Seeding the bundled versions is idempotent and new teams use pointer evidence", async () => {
  await R.promptVersions();
  await R.prompt("evidence-first.web.v7");
  const rows = await (
    await S.db()
  )
    .prepare("SELECT id FROM yi_prompts WHERE id=$1")
    .all("evidence-first.web.v7");
  assert.equal(rows.length, 1);
  const all = await R.promptVersions();
  assert.equal(
    new Set(all.map((p: { id: string }) => p.id)).size,
    all.length,
    "a bundled version was seeded twice",
  );
  // Standalone completion defaults new teams to the pointer-evidence prompt.
  assert.equal(teamDefaults().prompts.version, "evidence-first.web.v8");
  // The compatibility preferences document keeps its historical default.
  assert.equal((await R.preferences()).promptVersion, "evidence-first.web.v5");
});
test("v7 asks for pointer evidence, sentiment-bearing mentions and a calibrated conviction", async () => {
  const p = await R.prompt("evidence-first.web.v7");
  for (const stage of [p.extraction, p.synthesis]) {
    assert.match(stage, /evidence_ranges/);
    assert.match(stage, /segment ID/i);
    assert.doesNotMatch(stage, /quote_original|quote_translation_en/);
  }
  assert.match(p.extraction, /CONVICTION CALIBRATION/);
  assert.match(p.extraction, /mentions/);
  assert.match(p.extraction, /sentiment/);
  assert.match(p.extraction, /rationale_en/);
  // The rubric's four levels, and the sentence that separates delivery from
  // commitment: without it a model grades the voice, not the claim.
  for (const level of [
    /high: .*(size|timing)/,
    /medium: .*hedg/,
    /low: .*(passing|hypothetical)/,
    /unspecified: /,
  ])
    assert.match(p.extraction, level);
  assert.match(p.extraction, /delivery|fluen/i);
  assert.match(p.critique, /CONVICTION AUDIT/);
  assert.match(p.critique, /one verdict for every supplied id|verdicts/);
  assert.doesNotMatch(p.transcribe, /evidence_ranges/);
  await (await S.db()).close();
});
