import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import {
  RESOURCES,
  dispatch,
  lookup,
  resourceOf,
} from "../src/server/youtube-intelligence/actions/index.ts";
import * as dispatchRoute from "../src/app/api/youtube-intelligence/[resource]/[action]/route.ts";
import * as legacyRoute from "../src/app/api/intelligence/research/route.ts";
import { upsertClaim } from "../src/server/youtube-intelligence/repos/claims.ts";
/** The actions the pre-F30 switch in the research route handled. */
const LEGACY_ACTIONS = [
  "captionProbe",
  "audioReview",
  "experiment",
  "shareSelection",
  "recoverAudit",
  "publishRun",
  "preferences",
  "prompt",
  "discoverChannels",
  "suggestEntities",
  "entityMerge",
  "entity",
  "follow",
  "channel",
  "pull",
  "backfillChannel",
  "pullOlder",
  "analyzeUpload",
  "saveIdea",
  "idea",
  "watch",
  "comparison",
  "review",
  "improvement",
  "synthesizeBriefing",
  "briefing",
  "share",
  "revoke",
  "performance",
];
const entries = Object.entries(RESOURCES).flatMap(([resource, table]) =>
  Object.entries(table).map(([action, entry]) => ({ resource, action, entry })),
);
const url = (resource: string, action: string) =>
  `http://127.0.0.1:3000/api/youtube-intelligence/${resource}/${action}`;
const params = (resource: string, action: string) => ({
  params: Promise.resolve({ resource, action }),
});
test("Every action resolves in exactly one resource table and the legacy set is complete", () => {
  const mutating = entries.filter((e) => e.entry.mutating).map((e) => e.action);
  assert.deepEqual([...mutating].sort(), [...LEGACY_ACTIONS].sort());
  assert.equal(new Set(entries.map((e) => e.action)).size, entries.length);
  for (const { resource, action } of entries)
    assert.equal(resourceOf(action), resource);
  assert.equal(resourceOf("nothingLikeThis"), undefined);
});
test("Every action is reachable through the new route, and only declared ones are", async () => {
  await freshDatabase();
  for (const { resource, action, entry } of entries) {
    if (!entry.mutating) {
      const r = await dispatchRoute.GET(
        new Request(url(resource, action)),
        params(resource, action),
      );
      assert.equal(r.status, 200, `${resource}/${action}`);
      continue;
    }
    // An input no action declares: the route has to reach the schema and be
    // refused by it, never by the table failing to find the action.
    const r = await dispatchRoute.POST(
      new Request(url(resource, action), {
        method: "POST",
        body: JSON.stringify({ __undeclared__: true }),
      }),
      params(resource, action),
    );
    assert.equal(r.status, 400, `${resource}/${action}`);
    assert.notEqual(
      (await r.json()).error,
      "Unknown action.",
      `${resource}/${action}`,
    );
  }
  const missing = await dispatchRoute.POST(
    new Request(url("research", "noSuchAction"), {
      method: "POST",
      body: "{}",
    }),
    params("research", "noSuchAction"),
  );
  assert.equal((await missing.json()).error, "Unknown action.");
  assert.throws(() => lookup("research", "constructor"), /Unknown action/);
});
test("An action refuses a field it does not declare", async () => {
  await freshDatabase();
  const declared = { ticker: "AAPL", enabled: true };
  assert.equal(
    (
      await dispatchRoute.POST(
        new Request(url("research", "watch"), {
          method: "POST",
          body: JSON.stringify(declared),
        }),
        params("research", "watch"),
      )
    ).status,
    200,
  );
  const r = await dispatchRoute.POST(
    new Request(url("research", "watch"), {
      method: "POST",
      body: JSON.stringify({ ...declared, ownerId: "someone-else" }),
    }),
    params("research", "watch"),
  );
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /unrecognized_keys|ownerId/);
  assert.equal(
    RESOURCES.research.watch.schema.safeParse({ ...declared, note: "x" })
      .success,
    false,
  );
});
test("A read answers GET and a write answers POST, never the other way round", async () => {
  await freshDatabase();
  const read = await dispatchRoute.POST(
    new Request(url("research", "snapshot"), { method: "POST", body: "null" }),
    params("research", "snapshot"),
  );
  assert.match((await read.json()).error, /only reads/);
  const write = await dispatchRoute.GET(
    new Request(url("research", "watch")),
    params("research", "watch"),
  );
  assert.match((await write.json()).error, /changes data/);
});
test("The read-only preview refuses a mutating action and still serves a reading one", async () => {
  await freshDatabase();
  const prior = process.env.YTI_PREVIEW_READ_ONLY;
  process.env.YTI_PREVIEW_READ_ONLY = "true";
  try {
    await assert.rejects(
      () => dispatch("research", "watch", { ticker: "AAPL", enabled: true }),
      /read-only/,
    );
    const snapshot = (await dispatch("research", "snapshot", undefined)) as {
      integrations: { readOnly: boolean };
    };
    assert.equal(snapshot.integrations.readOnly, true);
  } finally {
    if (prior === undefined) delete process.env.YTI_PREVIEW_READ_ONLY;
    else process.env.YTI_PREVIEW_READ_ONLY = prior;
  }
});
test("The old route still answers identically for a representative action", async () => {
  await freshDatabase();
  const body = (action: string, data: unknown) =>
    JSON.stringify({ action, data });
  const legacy = await legacyRoute.POST(
    new Request("http://127.0.0.1:3000/api/intelligence/research", {
      method: "POST",
      body: body("watch", { ticker: "MSFT", enabled: true }),
    }),
  );
  assert.equal(legacy.status, 200);
  const viaAlias = await legacy.json();
  const direct = await dispatchRoute.POST(
    new Request(url("research", "watch"), {
      method: "POST",
      body: JSON.stringify({ ticker: "MSFT", enabled: true }),
    }),
    params("research", "watch"),
  );
  assert.deepEqual(await direct.json(), viaAlias);
  // The envelope is still refused the same way, and a read action is not a
  // legacy action name.
  const unknown = await legacyRoute.POST(
    new Request("http://127.0.0.1:3000/api/intelligence/research", {
      method: "POST",
      body: body("snapshot", null),
    }),
  );
  assert.equal((await unknown.json()).error, "Unknown research action.");
  const preferences = await legacyRoute.GET(
    new Request(
      "http://127.0.0.1:3000/api/intelligence/research?view=preferences",
    ),
  );
  assert.ok((await preferences.json()).preferences.timezone);
});
test("The snapshot reports the claim and mention rows it left behind", async () => {
  await freshDatabase();
  const claim = (n: number) => ({
    id: `run-one:${n}`,
    runId: "run-one",
    videoId: "video-one0",
    channelId: null,
    instrument: null,
    ticker: "AAPL",
    tickerExplicit: true,
    stance: "long",
    thesisEn: `Thesis ${n}`,
    horizonEn: null,
    conditionsEn: [],
    risksEn: [],
    creatorConviction: "high",
    trustLevel: "L1" as const,
    trustBasis: {},
    configHash: null,
    publishedAt: null,
  });
  for (let n = 0; n < 3; n++) await upsertClaim(claim(n));
  const small = (await dispatch("research", "snapshot", undefined)) as {
    counts: Record<
      string,
      { returned: number; total: number; truncated: boolean }
    >;
    claims: unknown[];
  };
  assert.deepEqual(small.counts.claims, {
    returned: 3,
    total: 3,
    truncated: false,
  });
  assert.deepEqual(small.counts.mentions, {
    returned: 0,
    total: 0,
    truncated: false,
  });
  for (let n = 3; n < 501; n++) await upsertClaim(claim(n));
  const large = (await dispatch("research", "snapshot", undefined)) as {
    counts: Record<
      string,
      { returned: number; total: number; truncated: boolean }
    >;
    claims: unknown[];
  };
  assert.equal(large.claims.length, 500);
  assert.deepEqual(large.counts.claims, {
    returned: 500,
    total: 501,
    truncated: true,
  });
});
