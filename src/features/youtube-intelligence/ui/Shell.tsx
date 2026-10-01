"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Radar,
  ChevronDown,
  Sun,
  Users,
  BarChart3,
  Bookmark,
  FlaskConical,
  Settings,
  Menu,
  X,
  BookOpen,
  Newspaper,
  Search,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "./workspace.tsx";
import { UnreadCount } from "./UnreadDot.tsx";
import {
  NAV_GROUPS,
  PHONE_TABS,
  isCurrentRoute,
} from "./navigation.ts";
import { CommandPalette, QuickSearchButton } from "./CommandPalette.tsx";
const icons: Record<string, LucideIcon> = {
  today: Sun,
  report: Newspaper,
  search: Search,
  trends: TrendingUp,
  leaderboard: BarChart3,
  channels: Users,
  saved: Bookmark,
  lab: FlaskConical,
  settings: Settings,
  methodology: BookOpen,
};
function WorkspaceShell({ children }: { children: ReactNode }) {
  const path = usePathname(),
    [open, setOpen] = useState(false);
  const { loading, error, notice, data, refresh, dismissError } =
    useWorkspace();
  return (
    <div
      className="yi-workspace"
      data-theme={data?.preferences.account.display.theme ?? "system"}
    >
      <a className="yi-skip" href="#yi-main">
        Skip to content
      </a>
      <header className="yi-top">
        <Link className="yi-brand" href="/youtube-intelligence/today">
          <span>
            <Radar size={27} />
          </span>
          finradar
        </Link>
        <nav className="yi-global-nav" aria-label="Workspace navigation">
          <details className="yi-module-menu">
            <summary>
              Intelligence <ChevronDown size={14} />
            </summary>
            <Link href="/youtube-intelligence/today">YouTube intelligence</Link>
          </details>
        </nav>
        <span className="yi-top-label">YouTube · standalone</span>
        <QuickSearchButton variant="icon" onOpen={() => setOpen(false)} />
        <button
          className="yi-menu"
          aria-expanded={open}
          aria-controls="yi-navigation"
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>
      <nav className="yi-mobile-nav" aria-label="Quick navigation">
        {PHONE_TABS.map(({ route, label, href }) => (
          <Link
            key={route}
            href={href}
            aria-current={isCurrentRoute(path, href) ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            {label}
          </Link>
        ))}
        <button
          className="yi-text-button"
          aria-expanded={open}
          aria-controls="yi-navigation"
          onClick={() => setOpen(!open)}
        >
          More <Menu size={15} />
        </button>
      </nav>
      <div className="yi-frame">
        <aside
          className={`yi-sidebar ${open ? "yi-open" : ""}`}
          id="yi-navigation"
        >
          <QuickSearchButton variant="sidebar" onOpen={() => setOpen(false)} />
          <nav aria-label="Research navigation" className="yi-nav-groups">
            {NAV_GROUPS.map((group, index) => (
              <div className="yi-nav-group" key={group.label}>
                <p className="yi-nav-group-label" id={`yi-nav-group-${index}`}>
                  {group.label}
                </p>
                <ul aria-labelledby={`yi-nav-group-${index}`}>
                  {group.items.map(({ route, label, href }) => {
                    const Icon = icons[route] ?? Sun;
                    return (
                      <li key={route}>
                        <Link
                          href={href}
                          aria-current={
                            isCurrentRoute(path, href) ? "page" : undefined
                          }
                          onClick={() => setOpen(false)}
                        >
                          <Icon size={17} />
                          {label}
                          {route === "today" && <UnreadCount />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div className="yi-sidebar-bottom">
            <p>
              Source-led research.
              <br />
              Evidence before conviction.
            </p>
          </div>
        </aside>
        <main id="yi-main" className="yi-main" tabIndex={-1}>
          {notice && (
            <div className="yi-notice" role="status">
              {notice}
            </div>
          )}
          {error && (
            <div className="yi-warning" role="alert">
              {error}{" "}
              <button className="yi-text-button" onClick={() => void refresh()}>
                Reload data
              </button>{" "}
              <button className="yi-text-button" onClick={dismissError}>
                Dismiss
              </button>
            </div>
          )}
          {data &&
            "fixtureMode" in data.snapshot.integrations &&
            data.snapshot.integrations.fixtureMode === true && (
              <p className="yi-warning">
                Fixture workspace · synthetic research data and offline
                providers. This is workflow validation, not live investment
                research.
              </p>
            )}
          {data?.snapshot.integrations.readOnly && (
            <p className="yi-warning">
              Read-only preview. Changes are disabled by the server.
            </p>
          )}
          {loading && !data ? (
            <div className="yi-loading" role="status">
              <span />
              Loading your research workspace…
            </div>
          ) : (
            children
          )}
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
export function Shell({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceProvider>
  );
}
