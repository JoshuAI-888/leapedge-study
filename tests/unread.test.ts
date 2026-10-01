import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEEN_LIMIT,
  TRACKED_HINT,
  UNREAD_KEY,
  isUnread,
  loadUnread,
  markAllSeen,
  markSeen,
  recordVisit,
  unreadRuns,
  type StorageLike,
} from "../src/features/youtube-intelligence/ui/unread.ts";

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: StorageLike = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
  return { map, get: () => storage };
}
const T0 = "2026-09-28T09:00:00.000Z",
  T1 = "2026-09-28T12:00:00.000Z",
  T2 = "2026-09-29T08:00:00.000Z";
const run = (id: string, at: string | null, status = "completed") => ({ id, at, status });

test("first use starts the watermark now, so an existing library is not all new", () => {
  const s = memory();
  const state = loadUnread(s.get, T1);
  assert.deepEqual(state, { since: T1, lastVisit: null, seen: [] });
  assert.equal(JSON.parse(s.map.get(UNREAD_KEY)!).since, T1);
  assert.equal(isUnread(state, run("old", T0)), false);
  assert.equal(isUnread(state, run("new", T2)), true);
});

test("new means finished after the watermark and not opened on this browser", () => {
  const s = memory();
  loadUnread(s.get, T0);
  const runs = [
    run("a", T1),
    run("b", T2),
    run("queued", T2, "queued"),
    run("failed", T2, "failed"),
    run("no-time", null),
    run("before", "2026-09-27T00:00:00.000Z"),
  ];
  assert.deepEqual(unreadRuns(loadUnread(s.get, T2), runs).map((r) => r.id), ["a", "b"]);
  const after = markSeen(s.get, ["a"], T2);
  assert.deepEqual(unreadRuns(after, runs).map((r) => r.id), ["b"]);
  // Seeing the same run twice keeps one entry.
  assert.deepEqual(markSeen(s.get, ["a"], T2)!.seen, ["a"]);
  // A run with no status (a Search video row) counts when it has a time.
  assert.equal(isUnread(after, { id: "v", at: T2 }), true);
});

test("Mark all as seen moves the watermark and empties the list", () => {
  const s = memory();
  loadUnread(s.get, T0);
  markSeen(s.get, ["a", "b"], T1);
  const state = markAllSeen(s.get, T2)!;
  assert.equal(state.since, T2);
  assert.deepEqual(state.seen, []);
  assert.equal(isUnread(state, run("c", T1)), false);
  assert.equal(isUnread(state, run("d", "2026-09-29T09:00:00.000Z")), true);
});

test("visits return the previous visit and record this one", () => {
  const s = memory();
  assert.equal(recordVisit(s.get, T0)!.previous, null);
  assert.equal(recordVisit(s.get, T1)!.previous, T0);
  assert.equal(loadUnread(s.get, T2)!.lastVisit, T1);
  // The watermark is not moved by a visit: only by Mark all as seen.
  assert.equal(loadUnread(s.get, T2)!.since, T0);
});

test("the seen list is capped", () => {
  const s = memory();
  loadUnread(s.get, T0);
  const ids = Array.from({ length: SEEN_LIMIT + 20 }, (_, i) => `r${i}`);
  const state = markSeen(s.get, ids, T1)!;
  assert.equal(state.seen.length, SEEN_LIMIT);
  assert.equal(state.seen.at(-1), `r${SEEN_LIMIT + 19}`);
});

test("blocked, missing or damaged storage never throws and shows no markers", () => {
  const blocked = () => {
    throw new Error("SecurityError: storage is disabled");
  };
  assert.equal(loadUnread(blocked, T0), null);
  assert.equal(markSeen(blocked, ["a"], T0), null);
  assert.equal(markAllSeen(blocked, T0), null);
  assert.equal(recordVisit(blocked, T0), null);
  assert.equal(isUnread(null, run("a", T2)), false);
  assert.deepEqual(unreadRuns(null, [run("a", T2)]), []);
  assert.equal(loadUnread(() => null, T0), null);
  const full: StorageLike = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(loadUnread(() => full, T0), null);
  // Damaged JSON or an old shape starts fresh rather than failing.
  for (const bad of ["{not json", JSON.stringify({ seen: "x" }), "null"]) {
    const s = memory({ [UNREAD_KEY]: bad });
    assert.deepEqual(loadUnread(s.get, T1), { since: T1, lastVisit: null, seen: [] });
  }
});

test("the hover never implies a person", () => {
  assert.equal(TRACKED_HINT, "Tracked on this browser");
});
