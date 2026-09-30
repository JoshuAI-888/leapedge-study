/**
 * Module navigation as data (decision D2) and the router map it must agree
 * with. The catch-all page resolves every path through `resolveRoute`, and
 * tests/ui-foundations.test.ts checks every sidebar and tab link resolves.
 */
export const BASE = "/youtube-intelligence";

export type NavItem = { route: string; label: string; href: string };
export type NavGroup = { label: string; items: NavItem[] };

const item = (route: string, label: string): NavItem => ({
  route,
  label,
  href: `${BASE}/${route}`,
});

export const NAV_GROUPS: NavGroup[] = [
  { label: "Read", items: [item("today", "Today"), item("report", "Daily report")] },
  {
    label: "Research",
    items: [
      item("search", "Search"),
      item("trends", "Trends"),
      item("leaderboard", "Leaderboard"),
    ],
  },
  { label: "Sources", items: [item("channels", "Channels")] },
  { label: "Your work", items: [item("saved", "Saved calls")] },
  {
    label: "Operate",
    items: [
      item("lab", "Lab"),
      item("settings", "Settings"),
      item("methodology", "Methodology"),
    ],
  },
];

/** Phone tab strip: Today · Report · Search, then a "More" button for the rest. */
export const PHONE_TABS: NavItem[] = [
  item("today", "Today"),
  item("report", "Report"),
  item("search", "Search"),
];

/** Until quick search (F76) lands, the sidebar field opens the Search page. */
export const QUICK_SEARCH_HREF = `${BASE}/search`;

/** Single-segment pages. */
export const SIMPLE_PAGES = [
  "today",
  "report",
  "search",
  "trends",
  "channels",
  "saved",
  "settings",
  "processing-profiles",
  "analysis-pipelines",
  "lab",
  "comparison",
  "methodology",
  "leaderboard",
] as const;
export type SimplePage = (typeof SIMPLE_PAGES)[number];

export type Route =
  | { page: Exclude<SimplePage, "report"> }
  | { page: "report"; date: string | null }
  | { page: "analysis"; id: string }
  | { page: "channel"; id: string };

const isCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};

/** The page for a path under /youtube-intelligence, or null for "not found". */
export function resolveRoute(path: string[]): Route | null {
  const [first, second, ...rest] = path;
  if (!first || rest.length) return null;
  if (second !== undefined) {
    if (!second) return null;
    if (first === "analysis") return { page: "analysis", id: second };
    if (first === "channels") return { page: "channel", id: second };
    if (first === "report")
      return isCalendarDate(second) ? { page: "report", date: second } : null;
    return null;
  }
  if (first === "report") return { page: "report", date: null };
  return (SIMPLE_PAGES as readonly string[]).includes(first)
    ? ({ page: first } as Route)
    : null;
}

/** Resolves a module href (as used in navigation) to its route. */
export function routeFromHref(href: string) {
  const path = href.split(/[?#]/)[0];
  if (!path.startsWith(`${BASE}/`)) return null;
  return resolveRoute(path.slice(BASE.length + 1).split("/"));
}

/** Whether `href` is the current page or a child of it (e.g. a channel page). */
export function isCurrentRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
