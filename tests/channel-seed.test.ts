import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { stubFetch, json } from "./helpers/fetch-stub.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import { doc, docs } from "../src/server/youtube-intelligence/research-store.ts";
import {
  getChannel,
  listChannels,
  listSeededChannels,
  upsertChannel,
} from "../src/server/youtube-intelligence/repos/channels.ts";
import {
  follow,
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
 * The lists that ship are placeholders, so every assertion here works from the
 * SHAPE of a seed list and builds its own entries. Replacing the JSON files
 * with the real lists changes nothing below.
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
const rowsSnapshot = async () =>
  (await database
    .prepare(
      "SELECT id,handle,title,tier,seed_source,discovery,processing,auto_analyze,active,favorite,created_at FROM channels ORDER BY id",
    )
    .all()) as Record<string, unknown>[];

test("The shipped seed lists parse, and say plainly that they are placeholders", () => {
  const lists = seedLists();
  assert.deepEqual(
    lists.map((l) => l.source),
    ["leapedge", "truealpha"],
  );
  assert.equal(lists[1].tier, 1, "the TrueAlphaData list is Tier 1");
  for (const l of lists) {
    assert.equal(l.placeholder, true);
    assert.match(l.note, /PLACEHOLDER/);
  }
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
  assert.equal(rows.length, 3 + 2 + 1, "the shared channel is not seeded twice");
  const both = (await getChannel(shared.id))!;
  assert.deepEqual(both.seedSource, ["leapedge", "truealpha"]);
  // Tier 1 from one list beats tier 2 from the other: a tier describes the
  // channel, not the list it was read from.
  assert.equal(both.tier, "1");
  assert.equal(both.title, "On both lists");
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
  // R5: discovery and spending are two switches. The channel is watched for new
  // uploads; nothing pays to analyse one until a person or a new selection says
  // so.
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
  assert.equal(seedRow.followedAt, null, "seeding a channel is not following it");
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
      PROCESSING_AUTOMATIC,
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
