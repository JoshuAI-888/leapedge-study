import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { stubFetch, json } from "./helpers/fetch-stub.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import {
  doc,
  docs,
  researchDB,
} from "../src/server/youtube-intelligence/research-store.ts";
import {
  COLUMNS,
  getChannel,
  listChannels,
  listSeededChannels,
  upsertChannel,
} from "../src/server/youtube-intelligence/repos/channels.ts";
import {
  follow,
  pullDue,
  updateChannel,
} from "../src/server/youtube-intelligence/channels.ts";
import {
  AUTOMATIC_TIER,
  DISCOVERY_SCHEDULED,
  LEAPEDGE_SELECTED,
  PROCESSING_AUTOMATIC,
  PROCESSING_ON_REQUEST,
  SELECTION_KIND,
  currentSelection,
  defaultSelection,
  resolveSeeds,
  seedChannels,
  selectionHistory,
} from "../src/server/youtube-intelligence/seed/channels.ts";
import {
  SeedList,
  seedLists,
  type SeedChannelData,
  type SeedListData,
} from "../src/server/youtube-intelligence/seed/lists.ts";
/**
 * Generic seeding assertions build fixture lists. The shipped-list assertion
 * separately verifies source-backed coverage and an honest missing ranking.
 */
function channelId(prefix: string, n: number) {
  const body = `${prefix}${String(n).padStart(3, "0")}`;
  if (body.length > 22) throw Error("test channel id prefix is too long");
  return `UC${body.padEnd(22, "0")}`;
}
function list(
  source: string,
  tier: number,
  count: number,
  overrides: SeedChannelData[] = [],
): SeedListData {
  const channels = Array.from({ length: count }, (_, i) => ({
    id: channelId(source, i + 1),
    handle: `@${source}-${i + 1}`,
    title: `${source} ${i + 1}`,
  }));
  return SeedList.parse({
    source,
    tier,
    placeholder: true,
    note: "Built by the test.",
    channels: [...overrides, ...channels],
  });
}
/**
 * Every column of the table, not a chosen few: a re-seed that quietly wiped a
 * polling cursor or a follow time would pass a snapshot that did not read them.
 * The list is asserted against the repository's own COLUMNS below, so a column
 * added later is compared here without anyone remembering to add it.
 */
const rowsSnapshot = async () =>
  (await database
    .prepare(`SELECT ${COLUMNS} FROM channels ORDER BY id`)
    .all()) as Record<string, unknown>[];

test("Shipped channels have source evidence; unavailable LeapEdge contributes no invented ranks", () => {
  const lists = seedLists();
  assert.deepEqual(
    lists.map((l) => l.source),
    ["leapedge", "truealpha"],
  );
  assert.equal(lists[0].placeholder, true);
  assert.equal(lists[0].channels.length, 0);
  assert.match(lists[0].note, /UNAVAILABLE/);
  assert.equal(lists[1].placeholder, false);
  assert.equal(lists[1].tier, 1);
  assert.equal(lists[1].channels.length, 8);
  const evidence = JSON.parse(
    readFileSync("docs/delivery/channel-seed-resolution.json", "utf8"),
  ) as { lookups: { channels: { id: string }[] }[] };
  assert.deepEqual(
    lists[1].channels.map((channel) => channel.id),
    evidence.lookups.map((row) => row.channels[0].id),
  );
  assert.ok(
    lists[1].channels.every((channel) => !channel.id.includes("PLACEHOLDER")),
  );
  const resolved = resolveSeeds(lists);
  assert.ok(resolved.every((channel) => channel.leapedgeRank === null));
  assert.equal(defaultSelection(resolved).length, 8);
});

test("A channel on both lists is one row, and it names both sources", async () => {
  await freshDatabase();
  const shared = {
    id: channelId("both", 1),
    handle: "@both-1",
    title: "On both lists",
  };
  await seedChannels([
    list("leapedge", 2, 3, [shared]),
    list("truealpha", 1, 2, [shared]),
  ]);
  const rows = await listSeededChannels();
  assert.equal(
    rows.length,
    3 + 2 + 1,
    "the shared channel is not seeded twice",
  );
  const both = (await getChannel(shared.id))!;
  assert.deepEqual(both.seedSource, ["leapedge", "truealpha"]);
  // Tier 1 from one list beats tier 2 from the other: a tier describes the
  // channel, not the list it was read from.
  assert.equal(both.tier, "1");
  assert.equal(both.title, "On both lists");
});

test("A channel that joins a second list later gains a source, and stays one row", async () => {
  await freshDatabase();
  const shared = {
    id: channelId("joins", 1),
    handle: "@joins-1",
    title: "Joins the second list later",
  };
  await seedChannels([list("leapedge", 2, 3, [shared])]);
  assert.deepEqual((await getChannel(shared.id))!.seedSource, ["leapedge"]);
  // The in-memory fold in resolveSeeds cannot reach this case: the second list
  // did not exist when the row was written, so the union has to happen in the
  // conflict branch of the INSERT. Every other test here seeds both lists at
  // once and so passes through the INSERT path only.
  await seedChannels([
    list("leapedge", 2, 3, [shared]),
    list("truealpha", 1, 2, [shared]),
  ]);
  const row = (await getChannel(shared.id))!;
  assert.deepEqual(row.seedSource, ["leapedge", "truealpha"]);
  assert.equal(
    row.tier,
    "1",
    "and it takes the stronger tier the new list gives it",
  );
  assert.equal(
    (await listSeededChannels()).filter((c) => c.id === shared.id).length,
    1,
  );
});

test("Seeding twice leaves the same rows and the same single selection", async () => {
  await freshDatabase();
  const lists = [list("leapedge", 2, 25), list("truealpha", 1, 4)];
  const first = await seedChannels(lists);
  assert.equal(first.recorded, true);
  // What a person decided between the runs must survive the second one. That
  // includes autoAnalyze and processing, the columns a re-projected selection
  // would trample — favorite alone proves nothing, because the projection never
  // touches it. The snapshot is taken after these changes, so the comparison
  // below masks nothing out.
  await updateChannel({ id: channelId("leapedge", 25), favorite: true });
  const chosen = channelId("leapedge", 1);
  await updateChannel({ id: chosen, autoAnalyze: false });
  // One row carried past the seed into the state a follow and a pull leave
  // behind. These are the columns a careless conflict branch resets, and the
  // ones that cost the most: followed_at is the cut-off deciding which uploads
  // automatic analysis pays for, and next_page_token is where a backfill had
  // got to. The snapshot is taken after this, so nothing below is masked out.
  const followed = channelId("leapedge", 3);
  await upsertChannel({
    ...(await getChannel(followed))!,
    uploads: "UU-followed",
    active: true,
    followedAt: "2026-06-01T00:00:00.000Z",
    lastPull: "2026-06-02T00:00:00.000Z",
    lastAttempt: "2026-06-02T00:00:00.000Z",
    nextPullAt: "2026-06-02T01:00:00.000Z",
    nextPageToken: "page-2",
    historyStarted: true,
  });
  const before = await rowsSnapshot();
  const second = await seedChannels(lists);
  assert.equal(second.recorded, false, "the same selection is recorded once");
  assert.equal(second.selection.id, first.selection.id);
  const after = await rowsSnapshot();
  assert.equal(after.length, before.length);
  assert.deepEqual(
    after,
    before,
    "no column is reset by a second run, and nothing is duplicated",
  );
  const kept = (await getChannel(chosen))!;
  assert.equal(
    kept.autoAnalyze,
    false,
    "a person turned the paid switch off; re-seeding does not turn it back on",
  );
  assert.equal(kept.processing, PROCESSING_ON_REQUEST);
  assert.equal((await getChannel(channelId("leapedge", 25)))!.favorite, true);
  const stillFollowed = (await getChannel(followed))!;
  assert.equal(stillFollowed.followedAt, "2026-06-01T00:00:00.000Z");
  assert.equal(stillFollowed.nextPageToken, "page-2");
  assert.equal(stillFollowed.uploads, "UU-followed");
  assert.equal(stillFollowed.historyStarted, true);
  assert.equal((await selectionHistory()).length, 1);
  assert.equal((await docs(SELECTION_KIND)).length, 1);
});

test("The default selection is exactly Tier 1 plus the LeapEdge top 20", async () => {
  await freshDatabase();
  // The rule is pinned to its literals, and the case below is built from 25 and
  // 20 rather than from the constants. Re-ranking the rule then shows up here as
  // a failing test rather than as a silent change in what gets paid for.
  assert.equal(AUTOMATIC_TIER, 1, "Tier 1 is selected outright");
  assert.equal(
    LEAPEDGE_SELECTED,
    20,
    "the LeapEdge list contributes its top 20",
  );
  const leapedge = list("leapedge", 2, 25);
  const truealpha = list("truealpha", 1, 4);
  const resolved = resolveSeeds([leapedge, truealpha]);
  const expected = [
    ...leapedge.channels.slice(0, 20).map((c) => c.id),
    ...truealpha.channels.map((c) => c.id),
  ].sort();
  assert.equal(expected.length, 24);
  assert.deepEqual(defaultSelection(resolved), expected);
  const result = await seedChannels([leapedge, truealpha]);
  assert.deepEqual(result.selection.channelIds, expected);
  const selection = (await currentSelection())!;
  assert.equal(selection.id, result.selection.id);
  assert.deepEqual(selection.channelIds, expected);
  const selected = (await listSeededChannels()).filter((c) => c.autoAnalyze);
  assert.deepEqual(
    selected.map((c) => c.id).sort(),
    expected,
    "the rows agree with the recorded selection",
  );
  assert.equal(selected.length, 24, "20 of the 25 LeapEdge entries, plus 4");
});

test("An unselected channel is seeded and discovered, but never analysed automatically", async () => {
  await freshDatabase();
  const leapedge = list("leapedge", 2, 23);
  await seedChannels([leapedge, list("truealpha", 1, 2)]);
  // The 21st LeapEdge entry: one past the top 20, by the literal.
  const unselected = (await getChannel(leapedge.channels[20].id))!;
  assert.equal(unselected.tier, "2");
  assert.deepEqual(unselected.seedSource, ["leapedge"]);
  // R5: discovery and spending are two switches. The row is recorded as one to
  // discover on a schedule — it is not polled until somebody follows it and an
  // uploads playlist is resolved — and nothing pays to analyse an upload until a
  // person or a new selection says so.
  assert.equal(unselected.discovery, DISCOVERY_SCHEDULED);
  assert.equal(unselected.processing, PROCESSING_ON_REQUEST);
  assert.equal(unselected.autoAnalyze, false);
  const selected = (await getChannel(leapedge.channels[0].id))!;
  assert.equal(selected.discovery, DISCOVERY_SCHEDULED);
  assert.equal(selected.processing, PROCESSING_AUTOMATIC);
  assert.equal(selected.autoAnalyze, true);
  const rows = await listSeededChannels();
  assert.equal(rows.length, 25);
  assert.equal(
    rows.filter((c) => c.autoAnalyze).length,
    22,
    "seeding eighty channels does not buy eighty channels' analysis",
  );
});

test("A channel appended to a list after the first seed run arrives with the paid switch off", async () => {
  await freshDatabase();
  const truealpha = list("truealpha", 1, 2);
  const first = await seedChannels([list("leapedge", 2, 22), truealpha]);
  assert.equal(first.recorded, true);
  // Appending entries the rule does not select leaves the selection identical,
  // so it is not recorded a second time and nothing is projected onto the rows.
  // What these rows hold is therefore exactly what the insert gave them, with
  // no later sweep to correct it — the only thing keeping them off paid
  // analysis. Every other assertion in this file reads a row after the
  // projection has already had its chance to fix it; this one does not.
  const grown = list("leapedge", 2, 27);
  const second = await seedChannels([grown, truealpha]);
  assert.equal(second.recorded, false, "the selection has not changed");
  assert.equal(second.selection.id, first.selection.id);
  for (const added of grown.channels.slice(22)) {
    const row = (await getChannel(added.id))!;
    assert.equal(
      row.autoAnalyze,
      false,
      "a seeded row is never inserted already paying",
    );
    assert.equal(row.processing, PROCESSING_ON_REQUEST);
    assert.equal(row.discovery, DISCOVERY_SCHEDULED);
  }
});

test("A seed run leaves a channel somebody followed by hand alone", async () => {
  await freshDatabase();
  const id = channelId("byhand", 1);
  await upsertChannel({
    id,
    handle: "@by-hand",
    title: "Followed by hand",
    uploads: "UU-by-hand",
    active: true,
    autoAnalyze: true,
    processing: PROCESSING_AUTOMATIC,
  });
  await seedChannels([list("leapedge", 2, 22), list("truealpha", 1, 2)]);
  const row = (await getChannel(id))!;
  assert.deepEqual(row.seedSource, [], "no list named it");
  assert.equal(
    row.autoAnalyze,
    true,
    "a selection does not switch a person's own channel off",
  );
  assert.equal(row.processing, PROCESSING_AUTOMATIC);
  assert.equal(
    (await listSeededChannels()).some((c) => c.id === id),
    false,
  );
});

test("A channel write lands in the table and is read back from it", async () => {
  await freshDatabase();
  const id = "UCFhJ8ZFg9W4kLwFTBBNIjOw";
  const seeded = list("truealpha", 1, 1, [
    { id, handle: "@seeded", title: "Seeded title" },
  ]);
  await seedChannels([seeded]);
  const seedRow = (await getChannel(id))!;
  assert.equal(
    seedRow.followedAt,
    null,
    "seeding a channel is not following it",
  );
  // A clear millisecond between the seed and the follow, so the two timestamps
  // below are comparable at the resolution Date.parse reads.
  await new Promise((r) => setTimeout(r, 5));
  const oldKey = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = "fixture-only";
  const stub = stubFetch([
    {
      url: "googleapis.com/youtube/v3",
      respond: () =>
        json({
          items: [
            {
              id,
              snippet: { title: "Followed title", customUrl: "@followed" },
              contentDetails: { relatedPlaylists: { uploads: "UU-followed" } },
            },
          ],
        }),
    },
  ]);
  try {
    const followed = await follow("@followed");
    assert.equal(followed.title, "Followed title");
    const row = (await getChannel(id))!;
    assert.equal(row.title, "Followed title");
    assert.equal(row.handle, "@followed");
    assert.equal(row.uploads, "UU-followed");
    assert.equal(row.active, true);
    // What the seed put there is still there: following a channel is not a
    // second source of truth about it.
    assert.equal(row.tier, "1");
    assert.deepEqual(row.seedSource, ["truealpha"]);
    // followed_at is the moment of the follow, not the seed run: pullDue uses it
    // as the cut-off for which uploads automatic analysis pays for, and a
    // channel seeded in January and followed in June must not buy the whole
    // back catalogue since January.
    assert.equal(
      Date.parse(row.followedAt!) > Date.parse(row.createdAt!),
      true,
      "followed_at is later than the seeded created_at",
    );
    // Following does not buy analysis; the explicit change does.
    assert.equal(row.autoAnalyze, true, "this one was selected by the seed");
    assert.equal(row.processing, PROCESSING_AUTOMATIC);
    await updateChannel({ id, favorite: true, autoAnalyze: false });
    const changed = (await getChannel(id))!;
    assert.equal(changed.favorite, true);
    assert.equal(changed.autoAnalyze, false);
    // processing says in words what auto_analyze gates on, so it moves with it.
    assert.equal(changed.processing, PROCESSING_ON_REQUEST);
    assert.equal(
      (await updateChannel({ id, autoAnalyze: true })).processing,
      "batch",
      "and back again",
    );
    assert.equal(changed.tier, "1");
    // The row is the only home: no `channel` document is written any more.
    assert.equal(await doc("channel", id), null);
    assert.equal((await listChannels()).length, 2);
  } finally {
    stub.restore();
    if (oldKey) process.env.YOUTUBE_API_KEY = oldKey;
    else delete process.env.YOUTUBE_API_KEY;
  }
});

test("A new selection is a new version beside the old one, not an edited state", async () => {
  await freshDatabase();
  const first = await seedChannels([list("truealpha", 1, 2)]);
  const promoted = list("truealpha", 1, 2, [
    { id: channelId("promoted", 1), handle: "@promoted-1", title: "Promoted" },
  ]);
  const second = await seedChannels([promoted]);
  assert.notEqual(second.selection.id, first.selection.id);
  const history = await selectionHistory();
  assert.equal(history.length, 2, "the earlier decision is still readable");
  assert.deepEqual(history[0].channelIds, second.selection.channelIds);
  assert.deepEqual(history[1].channelIds, first.selection.channelIds);
  assert.equal((await getChannel(channelId("promoted", 1)))!.autoAnalyze, true);
});

test("A new selection re-projects the rows, but never overrules a person", async () => {
  await freshDatabase();
  const leapedge = list("leapedge", 2, 25);
  const first = await seedChannels([leapedge, list("truealpha", 1, 4)]);
  assert.equal(first.recorded, true);
  // Two deliberate decisions, one in each direction, on rows a seed list named.
  const off = channelId("leapedge", 1); // the rule selected it; switched off
  const on = channelId("leapedge", 25); // the rule did not; switched on
  await updateChannel({ id: off, autoAnalyze: false });
  await updateChannel({ id: on, autoAnalyze: true });
  // Growing a list with a Tier-1 channel DOES change the selection, so it is
  // recorded and projected onto the rows. That projection is the hazard: it
  // sweeps every seeded row, including the two just set by hand. Curating a
  // list is not a decision to spend money on channels nobody chose.
  const second = await seedChannels([leapedge, list("truealpha", 1, 5)]);
  assert.equal(second.recorded, true, "the selection really did change");
  assert.notEqual(second.selection.id, first.selection.id);
  const kept = (await getChannel(off))!;
  assert.equal(
    kept.autoAnalyze,
    false,
    "growing a list does not start paying for a channel somebody switched off",
  );
  assert.equal(kept.processing, PROCESSING_ON_REQUEST);
  const held = (await getChannel(on))!;
  assert.equal(
    held.autoAnalyze,
    true,
    "nor stop paying for one somebody switched on",
  );
  assert.equal(held.processing, "batch");
  // The projection still does its job on every row nobody has touched: the new
  // Tier-1 entry is selected, and this run is what switches it on.
  const added = (await getChannel(channelId("truealpha", 5)))!;
  assert.equal(added.autoAnalyze, true);
  assert.equal(added.processing, PROCESSING_AUTOMATIC);
  // And a row the earlier selection already had stays where it was.
  assert.equal((await getChannel(channelId("leapedge", 2)))!.autoAnalyze, true);
});

test("pullDue discovers freely and spends only where both switches agree", async () => {
  await freshDatabase();
  // followed_at sits between the two uploads, so the older one is back
  // catalogue and the newer one is why the channel was followed.
  const followedAt = "2026-06-01T00:00:00.000Z";
  const before = "2026-05-01T00:00:00.000Z";
  const after = "2026-06-02T00:00:00.000Z";
  const onRequest = channelId("gateoff", 1);
  const automatic = channelId("gateon", 1);
  for (const [id, processing] of [
    [onRequest, PROCESSING_ON_REQUEST],
    [automatic, PROCESSING_AUTOMATIC],
  ] as const)
    await upsertChannel({
      id,
      handle: `@${id}`,
      title: id,
      uploads: `UU-${id}`,
      active: true,
      // Both rows say to analyse automatically. What separates them is
      // `processing`, and a row that says `on-request` is not paid for
      // whatever auto_analyze holds.
      autoAnalyze: true,
      processing,
      followedAt,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  const video = (n: string, publishedAt: string) => ({
    contentDetails: { videoId: n, videoPublishedAt: publishedAt },
    snippet: { title: n, publishedAt },
  });
  const oldKey = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = "fixture-only";
  const stub = stubFetch([
    {
      url: "googleapis.com/youtube/v3/playlistItems",
      respond: (call) => {
        const playlist = new URL(call.url).searchParams.get("playlistId")!;
        // Two channels, two distinct pairs of uploads: the same video id under
        // both would be deduplicated by the discoveries primary key and the
        // second channel would look as though it had never been polled.
        const tag = playlist.endsWith(onRequest) ? "gateoff1" : "gateon01";
        return json({
          items: [video(`${tag}old`, before), video(`${tag}new`, after)],
        });
      },
    },
  ]);
  try {
    await pullDue();
  } finally {
    stub.restore();
    if (oldKey) process.env.YOUTUBE_API_KEY = oldKey;
    else delete process.env.YOUTUBE_API_KEY;
  }
  const rows = (await (
    await researchDB()
  )
    .prepare(
      "SELECT video_id,channel_id,run_id FROM yi_discoveries ORDER BY video_id",
    )
    .all()) as {
    video_id: string;
    channel_id: string;
    run_id: string | null;
  }[];
  // Discovery is the free half and runs for both channels: four uploads found.
  assert.equal(rows.length, 4, "both channels were polled");
  const queued = rows.filter((r) => r.run_id).map((r) => r.video_id);
  // Exactly one analysis was paid for: the upload published after the follow,
  // on the channel whose two switches agree.
  assert.deepEqual(queued, ["gateon01new"], JSON.stringify(rows));
  assert.equal(
    rows.filter((r) => r.channel_id === onRequest && r.run_id).length,
    0,
    "a row saying on-request buys nothing, whatever auto_analyze holds",
  );
  assert.equal(
    rows.find((r) => r.video_id === "gateon01old")!.run_id,
    null,
    "following a channel does not buy its back catalogue",
  );
});

test("catalog setup is metadata only, skips unavailable sources, and preserves explicit choices", async () => {
  await freshDatabase();
  const { seedCatalog } =
    await import("../src/server/youtube-intelligence/seed/channels.ts");
  const confirmed = { ...list("confirmed", 1, 2), placeholder: false };
  const unavailable = list("unavailable", 1, 1);
  await seedCatalog([confirmed, unavailable]);
  let rows = await listChannels();
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every(
      (c) =>
        !c.autoAnalyze &&
        !c.active &&
        !c.uploads &&
        c.processing === PROCESSING_ON_REQUEST,
    ),
  );
  assert.equal(
    (await selectionHistory()).length,
    0,
    "metadata setup never creates a paid selection",
  );
  await updateChannel({ id: rows[0].id, autoAnalyze: true, favorite: true });
  await seedCatalog([confirmed, unavailable]);
  rows = await listChannels();
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((c) => c.autoAnalyze && c.favorite).length, 1);
});
