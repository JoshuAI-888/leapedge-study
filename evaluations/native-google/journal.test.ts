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

test("Explicit quota retry links prior evidence and cannot retry uncertain or duplicate requests", () => {
  const d = mkdtempSync(join(tmpdir(), "native-google-retry-"));
  try {
    const a = reserve(d, "quota", 10);
    finish(d, a.id, "quota_or_rate_limit", "private.json");
    const retry = reserve(d, "quota", 10, a.id);
    assert.equal(retry.retryOf, a.id);
    assert.throws(() => reserve(d, "quota", 10, a.id), /already/);
    const b = reserve(d, "uncertain", 10);
    finish(d, b.id, "transport_uncertain", "private2.json");
    assert.throws(
      () => reserve(d, "uncertain", 10, b.id),
      /matching explicit quota/,
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
