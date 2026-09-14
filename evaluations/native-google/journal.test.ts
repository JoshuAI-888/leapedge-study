import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reserve, saveArtifact, finish } from "./journal.ts";
test("Journal prevents repeated submissions, caps reservations and preserves unique redacted artifacts", () => {
  const d = mkdtempSync(join(tmpdir(), "native-google-"));
  try {
    const a = reserve(d, "first", 5);
    const p = saveArtifact(d, a, { error: "secret-value" }, ["secret-value"]);
    assert.equal(readFileSync(p, "utf8").includes("secret-value"), false);
    finish(d, a.id, "transport_uncertain", p);
    assert.throws(() => reserve(d, "first", 5), /already/);
    const b = reserve(d, "second", 5);
    assert.notEqual(a.id, b.id);
    assert.throws(() => saveArtifact(d, a, {}), /EEXIST/);
    assert.throws(() => reserve(d, "third", 5), /cap/);
    assert.equal(
      JSON.parse(readFileSync(join(d, "ledger.json"), "utf8")).reduce(
        (n: number, r: any) => n + r.reservedNzd,
        0,
      ),
      5,
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
