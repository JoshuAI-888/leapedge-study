/**
 * Pure logic behind quick search (F76): matching, ranking and grouping over
 * the server-built index (query/searchIndex, F56), YouTube link detection,
 * and the last-five recent searches. Kept free of React so
 * tests/command-palette.test.ts covers it directly.
 */
import type { NavItem } from "./navigation.ts";

const BASE = "/youtube-intelligence";

export type PaletteIndex = {
  instruments: { instrument: string; label: string | null; kind: string; calls: number }[];
  channels: { channelId: string; title: string | null; handle: string | null; calls: number; videos: number }[];
  videos: { runId: string; videoId: string; title: string | null; channelId: string | null; publishedAt: string | null }[];
};
export const GROUPS = ["Recent", "Actions", "Instruments", "Channels", "Videos", "Pages"] as const;
export type PaletteGroup = (typeof GROUPS)[number];
export type PaletteItem = {
  id: string;
  group: PaletteGroup;
  label: string;
  detail?: string;
  /** Where Enter goes. */
  href?: string;
  /** Where Cmd/Ctrl+Enter goes (instruments: Trends). */
  altHref?: string;
  /** Recent: put this text back in the box. */
  query?: string;
  /** Actions: analyse a pasted YouTube link. */
  analyse?: string;
};
export const GROUP_CAPS: Record<PaletteGroup, number> = {
  Recent: 5,
  Actions: 2,
  Instruments: 6,
  Channels: 4,
  Videos: 5,
  Pages: 4,
};

/**
 * A pasted YouTube link, normalised to its watch URL, or null. Accepts
 * youtube.com/watch, youtu.be, shorts, live and embed links, with or without
 * a scheme or "www."/"m.".
 */
export function youtubeUrl(text: string): string | null {
  const raw = text.trim();
  if (!raw || /\s/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = /^\/(?:shorts|live|embed|v)\/([^/]+)/.exec(url.pathname);
      id = m?.[1] ?? null;
    }
  }
  return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

/**
 * How well `text` matches `query`, case-insensitively and for any script:
 * 3 exact, 2 prefix (of the text or of a word in it), 1 substring, 0 none.
 */
export function matchScore(text: string | null | undefined, query: string): number {
  if (!text) return 0;
  const t = text.normalize("NFKC").toLowerCase();
  const q = query.normalize("NFKC").trim().toLowerCase();
  if (!q) return 0;
  if (t === q) return 3;
  if (t.startsWith(q) || t.split(/[\s·/,&|｜-]+/).some((w) => w.startsWith(q))) return 2;
  return t.includes(q) ? 1 : 0;
}
const best = (query: string, ...texts: (string | null | undefined)[]) =>
  Math.max(0, ...texts.map((t) => matchScore(t, query)));

function ranked<T>(items: T[], score: (item: T) => number, weight: (item: T) => number) {
  return items
    .map((item, order) => ({ item, s: score(item), w: weight(item), order }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.w - a.w || a.order - b.order)
    .map((x) => x.item);
}
const plural = (n: number, one: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : `${one}s`}`;
const isTicker = (kind: string) => kind === "stock" || kind === "crypto" || kind === "equity";

/** Search and Trends links for one instrument key. */
export function instrumentLinks(key: string, kind: string) {
  const search = isTicker(kind)
    ? new URLSearchParams({ ticker: key })
    : kind === "macro" || kind === "sector"
      ? new URLSearchParams({ kind, instrument: key })
      : new URLSearchParams({ instrument: key });
  return {
    href: `${BASE}/search?${search}`,
    altHref: `${BASE}/trends?${new URLSearchParams({ by: "ticker", value: key })}`,
  };
}

/**
 * The grouped results for `query`: a pasted YouTube link offers "Analyse
 * this video"; otherwise instruments (exact ticker first, then prefix, then
 * substring; more calls first within a tier), channels, videos and pages,
 * each capped. An empty query shows the recent searches and the pages.
 */
export function paletteResults(
  index: PaletteIndex | null,
  pages: NavItem[],
  query: string,
  recent: string[] = [],
): { group: PaletteGroup; items: PaletteItem[] }[] {
  const q = query.trim();
  const groups = new Map<PaletteGroup, PaletteItem[]>();
  const put = (group: PaletteGroup, items: PaletteItem[]) => {
    if (items.length) groups.set(group, items.slice(0, GROUP_CAPS[group]));
  };
  if (!q) {
    put("Recent", recent.map((r) => ({ id: `recent:${r}`, group: "Recent", label: r, query: r })));
    put("Pages", pages.map((p) => ({ id: `page:${p.route}`, group: "Pages", label: p.label, href: p.href })));
    return GROUPS.filter((g) => groups.has(g)).map((g) => ({ group: g, items: groups.get(g)! }));
  }
  const link = youtubeUrl(q);
  if (link) {
    put("Actions", [{ id: "analyse", group: "Actions", label: "Analyse this video", detail: link, analyse: link }]);
    return GROUPS.filter((g) => groups.has(g)).map((g) => ({ group: g, items: groups.get(g)! }));
  }
  if (index) {
    const instruments = ranked(index.instruments, (i) => best(q, i.instrument, i.label), (i) => i.calls);
    put(
      "Instruments",
      instruments.map((i) => ({
        id: `instrument:${i.instrument}`,
        group: "Instruments",
        label: i.label ?? i.instrument,
        detail: `${i.label && i.label !== i.instrument ? `${i.instrument} · ` : ""}${plural(i.calls, "call")}`,
        ...instrumentLinks(i.instrument, i.kind),
      })),
    );
    const top = instruments[0];
    if (top)
      put("Actions", [
        {
          id: "trends",
          group: "Actions",
          label: `See trends for ${top.label ?? top.instrument}`,
          href: instrumentLinks(top.instrument, top.kind).altHref,
        },
      ]);
    put(
      "Channels",
      ranked(index.channels, (c) => best(q, c.title, c.handle, c.channelId), (c) => c.calls).map((c) => ({
        id: `channel:${c.channelId}`,
        group: "Channels",
        label: c.title ?? c.handle ?? c.channelId,
        detail: `${c.handle ? `${c.handle} · ` : ""}${plural(c.calls, "call")}`,
        href: `${BASE}/channels/${encodeURIComponent(c.channelId)}`,
      })),
    );
    const channelTitle = new Map(index.channels.map((c) => [c.channelId, c.title]));
    put(
      "Videos",
      ranked(index.videos, (v) => best(q, v.title), () => 0).map((v) => ({
        id: `video:${v.runId}`,
        group: "Videos",
        label: v.title ?? v.videoId,
        detail: (v.channelId && channelTitle.get(v.channelId)) || undefined,
        href: `${BASE}/analysis/${encodeURIComponent(v.runId)}`,
      })),
    );
  }
  put(
    "Pages",
    ranked(pages, (p) => best(q, p.label), () => 0).map((p) => ({
      id: `page:${p.route}`,
      group: "Pages",
      label: p.label,
      href: p.href,
    })),
  );
  return GROUPS.filter((g) => groups.has(g)).map((g) => ({ group: g, items: groups.get(g)! }));
}

/** The recent list with `query` at the front: trimmed, no duplicates (ignoring case), at most five. */
export function rememberSearch(recent: string[], query: string): string[] {
  const q = query.trim();
  if (!q) return recent.slice(0, 5);
  return [q, ...recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 5);
}
export const RECENT_KEY = "yti:quick-search:recent";
type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void };
/** Recent searches from storage; empty when storage is missing, blocked or holds junk. */
export function loadRecent(store: Store | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "").slice(0, 5)
      : [];
  } catch {
    return [];
  }
}
export function saveRecent(store: Store | null | undefined, recent: string[]) {
  try {
    store?.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 5)));
  } catch {
    /* Storage is a convenience; a blocked store just forgets. */
  }
}
