import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, normalize } from "node:path";

/**
 * Repository conventions, as assertions rather than prose.
 *
 * Build plan section 6 names this file for the --experimental-strip-types
 * limits. It carries the rest of the drift guards too, because every defect the
 * 18 September delivery review found was a documented rule that nothing
 * enforced: a retired module advertised in the README for three days, a deleted
 * function restored to serve a harness, a NUL byte that made a test file
 * unreviewable, links pointing at moved documents.
 *
 * Adding to a list here is the deliberate act. Silence is not.
 */

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

/** Everything still in play: archives keep the history and are exempt. */
const ARCHIVED = (path: string) =>
  path.startsWith("docs/archive/") || path.startsWith("scripts/archive/");

const liveCode = tracked.filter(
  (p) => /\.(ts|tsx|mjs)$/.test(p) && !ARCHIVED(p),
);
const liveDocs = tracked.filter((p) => /\.md$/.test(p) && !ARCHIVED(p));
const read = (p: string) => readFileSync(p, "utf8");

// ---------------------------------------------------------------------------

test("No TypeScript that --experimental-strip-types cannot strip", () => {
  // Node runs the .ts sources directly, so a construct that needs emitting is
  // not a style question: it is a file that will not run.
  const banned: [RegExp, string][] = [
    [/^\s*(export\s+)?(const\s+)?enum\s+\w+/m, "enum (use a const object or a zod enum)"],
    [/^\s*(export\s+)?(declare\s+)?namespace\s+\w+/m, "namespace"],
    [
      /constructor\s*\([^)]*\b(private|public|protected|readonly)\s+\w+/s,
      "parameter property in a constructor",
    ],
  ];
  for (const path of liveCode) {
    if (path.endsWith("tests/conventions.test.ts")) continue;
    const source = read(path);
    for (const [pattern, what] of banned)
      assert.ok(
        !pattern.test(source),
        `${path} uses a ${what}, which --experimental-strip-types cannot strip`,
      );
  }
});

// ---------------------------------------------------------------------------

/**
 * Names that were deliberately retired. A retired thing coming back is how
 * `chunking.auditSource` survived F15: the pipeline stopped calling it, an
 * evaluation harness still did, and a later commit restored it with nothing to
 * object. Retire something, add it here, and it stays retired.
 */
const RETIRED_IN_CODE: Record<string, string[] | null> = {
  "youtubei.js": null, // F20
  youtubejs: null, // F20
  auditSource: null, // deleted 18 September with evaluations/native-google
  splitExactBoundaryQuotes: null, // superseded by F12 pointer evidence
  promptfoo: null, // deleted 18 September; the gold set is the only evaluation set
  "source-repair": [
    // The test whose whole point is asserting the stage F15 removed is gone.
    "tests/critique.test.ts",
    // Routing tests use the old name as their example of a stage with no
    // settings key, which is exactly what it is now.
    "tests/transport.test.ts",
  ],
  "provider.only": [
    // F11 took the pin off the OpenRouter path; the comments record why it was
    // there, which is worth keeping where the next person will look for it.
    "src/server/youtube-intelligence/transport/openrouter.ts",
    "tests/transport.test.ts",
  ],
};

test("No retired identifier is back in live code", () => {
  const found: string[] = [];
  for (const path of liveCode) {
    if (path.endsWith("tests/conventions.test.ts")) continue;
    const source = read(path);
    for (const [name, allowed] of Object.entries(RETIRED_IN_CODE))
      if (source.includes(name) && !allowed?.includes(path))
        found.push(`${path} names "${name}"`);
  }
  assert.deepEqual(
    found,
    [],
    `retired identifiers are back in live code:\n  ${found.join("\n  ")}\nIf one is genuinely needed again, change its entry in RETIRED_IN_CODE and say why in the commit.`,
  );
});

/**
 * Things a live document must not present as current. The value is `null` for
 * "nowhere", or the documents allowed to name it because they are explaining
 * its removal rather than advertising it.
 */
const RETIRED_IN_DOCS: Record<string, string[] | null> = {
  // F20 deleted the adapter and the dependency on 17 September 2026.
  "YouTube.js": [
    // Spec section 12's "What is dropped, and why" table lists it as dropped.
    "docs/spec/youtube-intelligence-v2-spec.md",
    // The operations runbook names the date it left the retrieval chain.
    "docs/production-and-integration.md",
    // The architecture note's decision table records removing it from the path.
    "docs/architecture/README.md",
  ],
  // The promptfoo tree was deleted on 18 September; the gold set is the only
  // evaluation set under spec revision 3.
  Promptfoo: null,
  promptfoo: null,
  // Removed from the design by spec revision 3. Both documents that name it
  // are telling the reader it is gone and that nothing about it is needed.
  VideoConviction: [
    "docs/spec/youtube-intelligence-v2-spec.md",
    "docs/handoff/phase-0-human-inputs.md",
    // The build plan keeps F07's row so the id is never reused.
    "docs/spec/youtube-intelligence-v2-build-plan.md",
  ],
};

test("No live document advertises something that was retired", () => {
  const found: string[] = [];
  for (const path of liveDocs) {
    if (path === "tests/conventions.test.ts") continue;
    // A dated review names what it found, including things it then retired.
    // It is a record of a moment, not a claim about the system today.
    if (path.startsWith("docs/review/")) continue;
    const text = read(path);
    for (const [phrase, allowed] of Object.entries(RETIRED_IN_DOCS))
      if (text.includes(phrase) && !allowed?.includes(path))
        found.push(`${path} names "${phrase}"`);
  }
  assert.deepEqual(
    found,
    [],
    `live documents name something retired:\n  ${found.join("\n  ")}\nMove the document to docs/archive, reword it, or add the path to RETIRED_IN_DOCS with a reason.`,
  );
});

// ---------------------------------------------------------------------------

test("No source file contains a control character", () => {
  // tests/metrics-registry.test.ts held a raw NUL as a map-key separator, so
  // git classified it as binary: no diff, not reviewable on GitHub, for a day.
  const control = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
  for (const path of [...liveCode, ...liveDocs, ...tracked.filter((p) => /\.(json|sql|yml|css)$/.test(p) && !ARCHIVED(p))]) {
    if (path === "tests/conventions.test.ts") continue;
    assert.ok(
      !control.test(read(path)),
      `${path} contains a control character; write it as an escape so the file stays text`,
    );
  }
});

// ---------------------------------------------------------------------------

/**
 * Spec 4.1: model traffic goes through a transport. Everything else that calls
 * out is an adapter for a named third party, and each one is listed with what
 * it talks to, so a new call site is a decision somebody makes on purpose.
 */
const MAY_FETCH: Record<string, string> = {
  "src/server/youtube-intelligence/transport/openrouter.ts": "the OpenRouter API",
  "src/server/youtube-intelligence/channels.ts": "the YouTube Data API",
  "src/server/youtube-intelligence/transcripts.ts": "TranscriptAPI and Supadata",
  "src/server/youtube-intelligence/market.ts": "FMP prices and filings",
  "src/server/youtube-intelligence/email.ts": "Resend",
  "src/server/youtube-intelligence/pipeline.ts":
    "YouTube video metadata only; every model call goes through a transport",
  "src/features/youtube-intelligence/IntelligenceApp.tsx": "this app's own API routes",
  "src/features/youtube-intelligence/ResearchApp.tsx": "this app's own API routes",
  "src/features/youtube-intelligence/CorpusPanel.tsx": "this app's own API routes",
};

test("Only listed adapters call fetch, and the list says what each one talks to", () => {
  for (const path of liveCode) {
    if (!path.startsWith("src/")) continue;
    if (!/\bfetch\s*\(/.test(read(path))) continue;
    assert.ok(
      MAY_FETCH[path],
      `${path} calls fetch. Model traffic belongs in a transport (spec 4.1); a third-party adapter belongs in MAY_FETCH in this file with what it talks to.`,
    );
  }
  for (const path of Object.keys(MAY_FETCH))
    assert.ok(
      existsSync(path),
      `MAY_FETCH lists ${path}, which no longer exists; drop the entry`,
    );
});

// ---------------------------------------------------------------------------

test("Every module under src has something that imports it", () => {
  // Next owns src/app and src/proxy.ts by convention; everything else earns
  // its place by being used.
  //
  // The one exception is groundwork: a module a feature that has not been
  // built yet names in its ledger entry. repos/jobs.ts is the live example —
  // it defines the jobs table F24 created, and F26 is what will import it.
  // The ledger entry is the escape hatch, so the intent is written down where
  // the next session reads it rather than inferred from an empty file.
  const ledger = JSON.parse(readFileSync("docs/delivery/ledger.json", "utf8")) as {
    features: { id: string; status: string; files: string[]; note?: string }[];
  };
  const groundwork = new Map<string, string>();
  for (const feature of ledger.features)
    if (feature.status === "todo")
      for (const file of feature.files) groundwork.set(file, feature.id);
  const modules = liveCode.filter(
    (p) =>
      (p.startsWith("src/features/") || p.startsWith("src/server/")) &&
      /\.(ts|tsx)$/.test(p),
  );
  const importers = [...liveCode]
    .map((p) => ({ path: p, source: read(p) }));
  for (const path of modules) {
    const file = path.split("/").pop()!;
    const stem = file.replace(/\.(tsx|ts)$/, "");
    const used = importers.some(
      (i) =>
        i.path !== path &&
        (i.source.includes(`/${file}"`) ||
          i.source.includes(`/${file}'`) ||
          i.source.includes(`/${stem}"`) ||
          i.source.includes(`/${stem}'`)),
    );
    const planned = groundwork.get(path);
    assert.ok(
      used || planned,
      `${path} is imported by nothing. Delete it, or if it is about to be used, name it in the files of the feature that will use it in docs/delivery/ledger.json.`,
    );
    if (!used && planned) {
      const feature = ledger.features.find((f) => f.id === planned)!;
      assert.ok(
        feature.note,
        `${path} is unused groundwork for ${planned}, so ${planned} must carry a note saying what it is waiting for`,
      );
    }
  }
});

// ---------------------------------------------------------------------------

test("Every relative link in a live document resolves", () => {
  // docs/ lost 98 files to the archive in one commit. A link check is what
  // makes that kind of move safe to do again.
  const link = /\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g;
  for (const path of liveDocs) {
    const base = dirname(path);
    for (const [, target] of read(path).matchAll(link)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const resolved = normalize(join(base, decodeURIComponent(target)));
      assert.ok(
        existsSync(resolved),
        `${path} links to ${target}, which does not exist`,
      );
    }
  }
});

// ---------------------------------------------------------------------------

test("No document is committed twice under two names", () => {
  // docs/spec/phase-0-human-inputs.md and docs/handoff/phase-0-human-inputs.md
  // were byte-identical for a day, two copies free to drift apart.
  const seen = new Map<string, string>();
  for (const path of tracked) {
    if (!/\.md$/.test(path)) continue;
    if (!existsSync(path) || statSync(path).size < 512) continue;
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    const first = seen.get(digest);
    assert.ok(
      !first,
      `${path} is byte-identical to ${first}; keep one and link to it`,
    );
    seen.set(digest, path);
  }
});

// ---------------------------------------------------------------------------

test("The build plan's claims about CI are true of the workflow", () => {
  // Build plan section 3 says CI runs the offline gate on the Postgres dialect.
  // It did not, for the whole of phase 1.
  const workflow = read(".github/workflows/verify.yml");
  for (const required of [
    "YTI_DB: pglite",
    "scripts/promotion-gate.ts --offline",
    "npm run typecheck",
    "npm run build",
    "npm audit",
  ])
    assert.ok(
      workflow.includes(required),
      `.github/workflows/verify.yml no longer runs "${required}", which the build plan requires`,
    );
});
