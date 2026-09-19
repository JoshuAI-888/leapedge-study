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
} from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "./workspace.tsx";
const navigation = [
  ["today", "Today", Sun],
  ["channels", "Channels", Users],
  ["leaderboard", "Leaderboard", BarChart3],
  ["saved", "Saved calls", Bookmark],
  ["lab", "Lab", FlaskConical],
  ["settings", "Settings", Settings],
] as const;
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
          <Link href="/youtube-intelligence/saved">Saved calls</Link>
          <Link href="/youtube-intelligence/settings">Settings</Link>
        </nav>
        <span className="yi-top-label">YouTube · standalone</span>
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
        {navigation.slice(0, 3).map(([route, label]) => (
          <Link
            key={route}
            href={`/youtube-intelligence/${route}`}
            aria-current={path.includes(`/${route}`) ? "page" : undefined}
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
          <p className="yi-eyebrow">YOUTUBE INTELLIGENCE</p>
          <nav aria-label="Research navigation">
            {navigation.map(([route, label, Icon]) => (
              <Link
                key={route}
                href={`/youtube-intelligence/${route}`}
                aria-current={path.includes(`/${route}`) ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <Icon size={18} />
                {label}
              </Link>
            ))}
          </nav>
          <div className="yi-sidebar-bottom">
            <Link
              href="/youtube-intelligence/methodology"
              onClick={() => setOpen(false)}
            >
              <BookOpen size={17} />
              Methodology
            </Link>
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
