import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  NAV_GROUPS,
  PHONE_TABS,
  resolveRoute,
  routeFromHref,
} from "../src/features/youtube-intelligence/ui/navigation.ts";
import { registry } from "../src/features/youtube-intelligence/metrics/registry.ts";
import { uiColumns } from "../src/features/youtube-intelligence/metrics/ui-columns.ts";
import { CHANNEL_COLUMNS } from "../src/features/youtube-intelligence/channel-list.ts";
import { PHASE5_DATABASE, phase5SeedRefusal } from "../scripts/seed-phase5.ts";

/**
 * F77, the phase-5 gate. Fast, deterministic checks that the LeapEdge-gap
 * surfaces are wired: every page resolves through the router map, the ledger's
 * F56–F76 files and tests exist, the requirements document has a section per
 * feature, every new table column is explained by the metric registry, and
 * the fixture seed refuses anything but the isolated local database. The
 * browser matrix itself is recorded in docs/gates/phase-5-baseline.json.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path: string) => existsSync(new URL(`../${path}`, import.meta.url));
const PHASE5 = Array.from({ length: 21 }, (_, i) => `F${56 + i}`);

test("every phase-5 page resolves through the router map", () => {
  const paths: [string[], string][] = [
    [["today"], "today"],
    [["report"], "report"],
    [["report", "2026-09-28"], "report"],
    [["search"], "search"],
    [["trends"], "trends"],
    [["channels"], "channels"],
    [["channels", "UCmacroMike0000000000001"], "channel"],
    [["analysis", "phase5-run-failed"], "analysis"],
    [["saved"], "saved"],
    [["leaderboard"], "leaderboard"],
    [["settings"], "settings"],
    [["methodology"], "methodology"],
  ];
  for (const [path, page] of paths)
    assert.equal(resolveRoute(path)?.page, page, `/${path.join("/")} should resolve to ${page}`);
  // The report's session date is validated, so a weekend date still resolves
  // (the page snaps it) but a malformed one is not found.
  assert.deepEqual(resolveRoute(["report", "2026-09-27"]), { page: "report", date: "2026-09-27" });
  assert.equal(resolveRoute(["report", "2026-02-30"]), null);
  assert.equal(resolveRoute(["trends", "extra"]), null);
});

test("every sidebar entry and phone tab resolves, and the phase-5 pages are in the sidebar", () => {
  const hrefs = [...NAV_GROUPS.flatMap((g) => g.items), ...PHONE_TABS].map((i) => i.href);
  for (const href of hrefs) assert.ok(routeFromHref(href), `${href} does not resolve`);
  const routes = new Set(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.route)));
  for (const route of ["today", "report", "search", "trends", "channels", "saved"])
    assert.ok(routes.has(route), `the sidebar has no ${route} entry`);
});

type LedgerFeature = { id: string; phase: number | null; status: string; files: string[]; tests: string[] };
const ledger = JSON.parse(read("docs/delivery/ledger.json")) as { features: LedgerFeature[] };

test("F56–F76 are in the ledger as phase 5, and every file and test they name exists", () => {
  for (const id of PHASE5.filter((f) => f !== "F77")) {
    const f = ledger.features.find((x) => x.id === id);
    assert.ok(f, `${id} is not in the ledger`);
    assert.equal(f.phase, 5, `${id} is not phase 5`);
    assert.notEqual(f.status, "removed", `${id} is removed`);
    assert.ok(f.files.length > 0 && f.tests.length > 0, `${id} names no files or tests`);
    for (const path of [...f.files, ...f.tests]) assert.ok(exists(path), `${id}: ${path} is missing`);
  }
});

test("the requirements document has a section for every phase-5 feature, F56 to F77", () => {
  const doc = read("docs/delivery/leapedge-gap-ux-proposals-20260929.md");
  for (const id of PHASE5)
    assert.match(doc, new RegExp(`^### ${id} — \\S`, "m"), `no "### ${id} — …" section`);
});

// The tables the LeapEdge-gap features added, and the source that renders them.
const NEW_TABLES: { surface: string; source: string }[] = [
  { surface: "today.calls", source: "src/features/youtube-intelligence/ui/pages/Today.tsx" },
  { surface: "report.calls", source: "src/features/youtube-intelligence/ui/pages/Report.tsx" },
  { surface: "trends.periods", source: "src/features/youtube-intelligence/ui/pages/Trends.tsx" },
  { surface: "channels.followed", source: "src/features/youtube-intelligence/ui/pages/Channels.tsx" },
  { surface: "analysis.modelCalls", source: "src/features/youtube-intelligence/ui/CallUsageTable.tsx" },
  { surface: "lab.stepUsage", source: "src/features/youtube-intelligence/ui/CallUsageTable.tsx" },
];
const registryIds = new Set(registry.map((m) => m.id));

test("the metric registry explains every column of the phase-5 tables", () => {
  for (const { surface } of NEW_TABLES) {
    const columns = uiColumns.filter((c) => c.surface === surface);
    assert.ok(columns.length > 0, `${surface} is not in the UI column manifest`);
    for (const c of columns) assert.ok(registryIds.has(c.metricId), `${surface} / ${c.column} -> ${c.metricId}`);
  }
  // Every literal heading id a phase-5 table renders is in the manifest for
  // that page's table, so a new column cannot ship without a definition.
  const manifestIds = new Set(uiColumns.map((c) => c.metricId));
  for (const { source } of NEW_TABLES) {
    for (const [, id] of read(source).matchAll(/<MetricHeading\s+id="([^"]+)"/g)) {
      assert.ok(registryIds.has(id), `${source}: ${id} is not in the registry`);
      assert.ok(manifestIds.has(id), `${source}: ${id} is not in the UI column manifest`);
    }
  }
  // The two tables that build their heading ids: Today's `today.${key}` and
  // the Channels list's `channels.${key}`.
  const today = uiColumns.filter((c) => c.surface === "today.calls").map((c) => c.metricId);
  for (const key of ["instrument", "stance", "thesis", "trust", "creators", "levels"])
    assert.ok(today.includes(`today.${key}`), `today.calls has no today.${key}`);
  assert.match(read(NEW_TABLES[0].source), /id=\{`today\.\$\{key\}`\}/);
  const channels = uiColumns.filter((c) => c.surface === "channels.followed").map((c) => c.metricId);
  assert.deepEqual(channels.sort(), CHANNEL_COLUMNS.map((c) => `channels.${c.key}`).sort());
  assert.match(read(NEW_TABLES[3].source), /id=\{`channels\.\$\{c\.key\}`\}/);
});

test("the phase-5 seed refuses anything but the isolated local gate database", () => {
  const good = {
    YTI_ISOLATED_DB: "true",
    YTI_FIXTURE_MODE: "true",
    DATABASE_URL: `postgres://postgres@127.0.0.1:5433/${PHASE5_DATABASE}`,
    DATABASE_URL_UNPOOLED: `postgres://postgres@localhost:5433/${PHASE5_DATABASE}`,
  };
  assert.equal(phase5SeedRefusal(good), null);
  const refused: Record<string, string | undefined>[] = [
    { ...good, YTI_ISOLATED_DB: undefined },
    { ...good, YTI_ISOLATED_DB: "false" },
    { ...good, YTI_FIXTURE_MODE: undefined },
    { ...good, DATABASE_URL: undefined },
    { ...good, DATABASE_URL: "not a url" },
    { ...good, DATABASE_URL: `mysql://127.0.0.1/${PHASE5_DATABASE}` },
    { ...good, DATABASE_URL: `postgres://user:pw@ep-cool-db.neon.tech/${PHASE5_DATABASE}` },
    { ...good, DATABASE_URL: "postgres://postgres@127.0.0.1:5433/yti_browser" },
    { ...good, DATABASE_URL: "postgres://postgres@127.0.0.1:5433/" },
    { ...good, DATABASE_URL_UNPOOLED: "postgres://postgres@10.0.0.5:5432/yti_phase5_gate" },
    { ...good, YTI_PRODUCTION_DB_HOST: "127.0.0.1" },
  ];
  for (const env of refused) assert.ok(phase5SeedRefusal(env), `accepted ${JSON.stringify(env)}`);
});
