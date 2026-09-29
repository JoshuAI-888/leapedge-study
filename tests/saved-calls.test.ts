import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import {
  callDate,
  expiringSoonest,
  expiryBadgeText,
  groupBySession,
  inTab,
  sinceSaved,
  sinceSavedText,
  tabCounts,
} from "../src/features/youtube-intelligence/saved-calls.ts";
import { dispatch } from "../src/server/youtube-intelligence/actions/index.ts";
import { doc, put } from "../src/server/youtube-intelligence/research-store.ts";
import { savePrices } from "../src/server/youtube-intelligence/repos/prices.ts";

const idea = (
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  status,
  savedAt: "2026-09-29T02:00:00.000Z",
  note: "",
  claim: { ticker: "NVDA", stance: "long", thesis_en: "Thesis" },
  ...extra,
});

test("Tab counts cover Open, Reviewed, Removed and All, and a tab keeps only its status", () => {
  const ideas = [
    idea("a", "open"),
    idea("b", "open"),
    idea("c", "done"),
    idea("d", "dismissed"),
  ];
  assert.deepEqual(tabCounts(ideas), { open: 2, done: 1, dismissed: 1, all: 4 });
  assert.deepEqual(tabCounts([]), { open: 0, done: 0, dismissed: 0, all: 0 });
  assert.deepEqual(
    ideas.filter((i) => inTab(i, "done")).map((i) => i.id),
    ["c"],
  );
  assert.equal(ideas.filter((i) => inTab(i, "all")).length, 4);
  // An unknown stored status counts in All only, never in a named tab.
  const odd = [idea("e", "archived")];
  assert.deepEqual(tabCounts(odd), { open: 0, done: 0, dismissed: 0, all: 1 });
});

test("The call date is the video's publish date, else the saved date, and says which", () => {
  assert.deepEqual(
    callDate(idea("a", "open", { publishedAt: "2026-09-28T13:00:00Z" })),
    { at: "2026-09-28T13:00:00Z", basis: "published" },
  );
  // A claim row's publish date is used when the saved idea predates the field.
  assert.deepEqual(callDate(idea("a", "open"), "2026-09-25T13:00:00Z"), {
    at: "2026-09-25T13:00:00Z",
    basis: "published",
  });
  assert.deepEqual(callDate(idea("a", "open")), {
    at: "2026-09-29T02:00:00.000Z",
    basis: "saved",
  });
  assert.deepEqual(callDate({ id: "x", status: "open" }), {
    at: null,
    basis: "saved",
  });
});

test("Saved calls group by trading session, newest session first", () => {
  const groups = groupBySession([
    // Mon 28 Sep 2026, 09:00 ET: before the open, so Monday's session.
    { id: "a", at: "2026-09-28T13:00:00Z", basis: "published" as const },
    // Mon 28 Sep 2026, 17:00 ET: after the close, so Tuesday's session.
    { id: "b", at: "2026-09-28T21:00:00Z", basis: "published" as const },
    // Sat 26 Sep: the weekend rolls forward to Monday.
    { id: "c", at: "2026-09-26T15:00:00Z", basis: "saved" as const },
    { id: "d", at: null, basis: "saved" as const },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.session, g.items.map((i) => i.id)]),
    [
      ["2026-09-29", ["b"]],
      ["2026-09-28", ["a", "c"]],
      [null, ["d"]],
    ],
  );
  assert.equal(groups[1].heading, "Mon 28 Sep · US session · 2 calls");
  assert.equal(groups[0].heading, "Tue 29 Sep · US session · 1 call");
  assert.equal(groups[2].heading, "Date unknown · 1 call");
  assert.match(groups[0].basis, /publish date/);
  assert.match(groups[1].basis, /1 by the video's publish date, 1 by the date you saved it/);
  assert.equal(groupBySession([]).length, 0);
});

test("Expiring soonest puts the nearest open expiry first, then expired, then none", () => {
  const today = "2026-09-29";
  const sorted = expiringSoonest(
    [
      { id: "none", expiryDate: null },
      { id: "far", expiryDate: "2026-12-31" },
      { id: "old", expiryDate: "2026-09-01" },
      { id: "recent", expiryDate: "2026-09-20" },
      { id: "soon", expiryDate: "2026-10-03" },
      { id: "today", expiryDate: "2026-09-29" },
      { id: "bad", expiryDate: "2026-02-31" },
    ],
    today,
  );
  assert.deepEqual(
    sorted.map((s) => s.id),
    ["today", "soon", "far", "recent", "old", "none", "bad"],
  );
});

test("The expiry badge reads 'Expires in 4 days' or 'Expired 2 Oct'", () => {
  const today = "2026-09-29";
  assert.deepEqual(expiryBadgeText("2026-10-03", today), {
    text: "Expires in 4 days",
    state: "soon",
  });
  assert.deepEqual(expiryBadgeText("2026-09-30", today), {
    text: "Expires in 1 day",
    state: "soon",
  });
  assert.deepEqual(expiryBadgeText("2026-09-29", today), {
    text: "Expires today",
    state: "soon",
  });
  assert.deepEqual(expiryBadgeText("2026-12-31", today), {
    text: "Expires in 93 days",
    state: "open",
  });
  assert.deepEqual(expiryBadgeText("2026-10-02", "2026-10-05"), {
    text: "Expired 2 Oct",
    state: "expired",
  });
  assert.equal(expiryBadgeText(null, today), null);
  assert.equal(expiryBadgeText("next spring", today), null);
});

test("Since saved measures from the call's session close to the latest close", () => {
  const series = [
    { date: "2026-09-24", adjustedClose: 90 },
    { date: "2026-09-25", adjustedClose: 100 },
    { date: "2026-09-28", adjustedClose: 104 },
    { date: "2026-09-29", adjustedClose: 105.5 },
  ];
  const s = sinceSaved(series, "2026-09-25");
  assert.equal(s.state, "priced");
  assert.ok(s.state === "priced");
  assert.equal(s.baseDate, "2026-09-25");
  assert.equal(s.latestDate, "2026-09-29");
  assert.ok(Math.abs(s.change - 0.055) < 1e-12);
  assert.equal(sinceSavedText(s), "+5.5% since 25 Sep close");
  // A session with no stored bar (a data gap) starts from the next close.
  const gap = sinceSaved(series, "2026-09-26");
  assert.ok(gap.state === "priced");
  assert.equal(gap.baseDate, "2026-09-28");
  assert.equal(sinceSavedText(sinceSaved(series.slice(0, 2), "2026-09-24")), "+11.1% since 24 Sep close");
  assert.equal(
    sinceSavedText(sinceSaved([{ date: "2026-09-25", adjustedClose: 100 }, { date: "2026-09-28", adjustedClose: 97 }], "2026-09-25")),
    "−3.0% since 25 Sep close",
  );
  // The call's own close is the latest one: no move to report yet.
  const same = sinceSaved(series, "2026-09-29");
  assert.equal(same.state, "no-later");
  assert.equal(sinceSavedText(same), "No close since 29 Sep yet");
  // Prices end before the call.
  assert.equal(sinceSaved(series, "2026-10-01").state, "no-price");
  assert.equal(sinceSaved([], "2026-09-25").state, "no-price");
  assert.equal(sinceSavedText(sinceSaved([], "2026-09-25")), "No price");
  // A zero or broken close is never divided by.
  const zero = sinceSaved(
    [
      { date: "2026-09-25", adjustedClose: 0 },
      { date: "2026-09-28", adjustedClose: 5 },
      { date: "2026-09-29", adjustedClose: 6 },
    ],
    "2026-09-25",
  );
  assert.ok(zero.state === "priced");
  assert.equal(zero.baseDate, "2026-09-28");
  assert.ok(Number.isFinite(zero.change));
});

test("The savedSince read returns the move from stored prices, and No price without a series", async () => {
  await freshDatabase();
  const fetchedAt = "2026-09-29T22:00:00.000Z";
  await savePrices(
    [
      ["2026-09-25", 100],
      ["2026-09-28", 102],
      ["2026-09-29", 110],
    ].map(([date, close]) => ({
      ticker: "NVDA",
      date: String(date),
      adjustedClose: Number(close),
      source: "test fixture",
      fetchedAt,
    })),
  );
  const result = (await dispatch("research", "savedSince", {
    calls: [
      { ticker: "NVDA", session: "2026-09-25" },
      { ticker: "ZZZZ", session: "2026-09-25" },
    ],
  })) as { ticker: string; session: string; since: ReturnType<typeof sinceSaved> }[];
  assert.equal(result.length, 2);
  assert.equal(result[0].since.state, "priced");
  assert.ok(result[0].since.state === "priced");
  assert.ok(Math.abs(result[0].since.change - 0.1) < 1e-12);
  assert.equal(result[1].since.state, "no-price");
  // No input is an empty answer, so the route's GET works without ?input=.
  assert.deepEqual(await dispatch("research", "savedSince", undefined), []);
  await assert.rejects(() =>
    dispatch("research", "savedSince", {
      calls: [{ ticker: "NVDA", session: "yesterday" }],
    }),
  );
});

test("deleteIdea deletes only a removed call and refuses every other status", async () => {
  await freshDatabase();
  for (const [id, status] of [
    ["run:open", "open"],
    ["run:done", "done"],
    ["run:gone", "dismissed"],
  ])
    await put("idea", id, idea(id, status));
  for (const id of ["run:open", "run:done"]) {
    await assert.rejects(
      () => dispatch("research", "deleteIdea", { id }),
      /Only a removed call can be deleted/,
    );
    assert.ok(await doc("idea", id), `${id} is kept`);
  }
  await assert.rejects(
    () => dispatch("research", "deleteIdea", { id: "run:missing" }),
    /not found/,
  );
  await assert.rejects(() =>
    dispatch("research", "deleteIdea", { id: "run:gone", extra: true }),
  );
  const deleted = await dispatch("research", "deleteIdea", { id: "run:gone" });
  assert.deepEqual(deleted, { id: "run:gone", deleted: true });
  assert.equal(await doc("idea", "run:gone"), null);
  const prior = process.env.YTI_PREVIEW_READ_ONLY;
  process.env.YTI_PREVIEW_READ_ONLY = "true";
  try {
    await assert.rejects(
      () => dispatch("research", "deleteIdea", { id: "run:open" }),
      /read-only/,
    );
  } finally {
    if (prior === undefined) delete process.env.YTI_PREVIEW_READ_ONLY;
    else process.env.YTI_PREVIEW_READ_ONLY = prior;
  }
});
