"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { action, read } from "./api.ts";
import { useWorkspace } from "./workspace.tsx";
import { dateLabel } from "./viewmodel.ts";
import { NAV_GROUPS } from "./navigation.ts";
import { trapFocus } from "./focus-trap.ts";
import {
  loadRecent,
  paletteResults,
  rememberSearch,
  saveRecent,
  type PaletteIndex,
  type PaletteItem,
} from "./command-palette.ts";

/**
 * Quick search (F76): ⌘K / Ctrl+K from any page, the field at the top of the
 * module sidebar, or the header icon on a phone. The index (instruments,
 * channels, recent videos) is read from query/searchIndex on first open and
 * kept for the session. Combobox and listbox roles; ↑↓ move, Enter opens,
 * ⌘/Ctrl+Enter opens Trends for an instrument, Esc closes and focus returns
 * to whatever opened it.
 */
const OPEN_EVENT = "yti:quick-search";
const pages = NAV_GROUPS.flatMap((g) => g.items);
let cached: Promise<PaletteIndex> | null = null;
function loadIndex() {
  cached ??= read<PaletteIndex>("query", "searchIndex", {}).catch((e: unknown) => {
    cached = null;
    throw e;
  });
  return cached;
}
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** A control that opens quick search: the sidebar field, or the phone header icon. */
export function QuickSearchButton({
  variant,
  onOpen,
}: {
  variant: "sidebar" | "icon";
  onOpen?: () => void;
}) {
  const open = (e: React.MouseEvent<HTMLButtonElement>) => {
    onOpen?.();
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: e.currentTarget }));
  };
  if (variant === "icon")
    return (
      <button type="button" className="yi-quick-search-icon" aria-label="Quick search" aria-haspopup="dialog" onClick={open}>
        <Search size={20} aria-hidden="true" />
      </button>
    );
  return (
    <button type="button" className="yi-quick-search-slot" aria-haspopup="dialog" onClick={open}>
      <Search size={15} aria-hidden="true" />
      <span>Search tickers, channels, videos</span>
      <kbd aria-hidden="true">⌘K</kbd>
    </button>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const { perform } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<PaletteIndex | null>(null);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);

  const show = useCallback((trigger: Element | null) => {
    opener.current = trigger ?? document.activeElement;
    setQuery("");
    setActive(0);
    setRecent(loadRecent(storage()));
    setOpen(true);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else show(document.activeElement);
      }
    };
    const onOpen = (e: Event) => show((e as CustomEvent<Element>).detail ?? null);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [show]);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      input.current?.focus();
      if (!index)
        loadIndex()
          .then((i) => {
            setIndex(i);
            setError("");
          })
          .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    } else if (!open && d.open) d.close();
  }, [open, index]);

  const groups = useMemo(() => paletteResults(index, pages, query, recent), [index, query, recent]);
  const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  useEffect(() => setActive(0), [query]);
  const current = items[Math.min(active, items.length - 1)];

  function close() {
    setOpen(false);
  }
  function remember() {
    const next = rememberSearch(recent, query);
    setRecent(next);
    saveRecent(storage(), next);
  }
  async function choose(item: PaletteItem, alternate = false) {
    if (item.query !== undefined) {
      setQuery(item.query);
      input.current?.focus();
      return;
    }
    if (item.analyse) {
      setBusy(true);
      let target: string | null = null;
      await perform(
        async () => {
          const { result } = await action<{
            result: { reused?: boolean; runId?: string; analysedAt?: string | null };
          }>("runs", "analyse", { url: item.analyse });
          if (result.runId) target = `/youtube-intelligence/analysis/${encodeURIComponent(result.runId)}`;
          return result;
        },
        (result) => {
          const r = result as { reused?: boolean; analysedAt?: string | null };
          // A finished analysis on the current pipeline is opened, not paid for again (F74).
          return r.reused
            ? `Already analysed ${dateLabel(r.analysedAt)} with the current pipeline. Opened it, no new cost.`
            : "Video queued. Its progress shows on its analysis page.";
        },
      );
      setBusy(false);
      // Close either way, so the outcome (the notice or the error) is visible.
      remember();
      close();
      if (target) router.push(target);
      return;
    }
    const href = alternate && item.altHref ? item.altHref : item.href;
    if (!href) return;
    remember();
    close();
    router.push(href);
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (Math.min(a, items.length - 1) + step + items.length) % items.length);
    } else if (e.key === "Enter" && current && !busy) {
      e.preventDefault();
      void choose(current, e.metaKey || e.ctrlKey);
    }
  }
  useEffect(() => {
    if (current) document.getElementById(optionId(current))?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const listId = "yi-quick-search-list";
  const status = error
    ? "The search index could not load, so only pages are listed."
    : !index && query.trim()
      ? "Loading instruments, channels and videos…"
      : items.length
        ? `${items.length} result${items.length === 1 ? "" : "s"}`
        : query.trim()
          ? "No matches"
          : "";
  return (
    <dialog
      ref={dialog}
      className="yi-palette"
      aria-label="Quick search"
      onClose={() => {
        setOpen(false);
        if (opener.current instanceof HTMLElement) opener.current.focus();
      }}
      onClick={(e) => {
        // A click on the backdrop (the dialog box itself, outside the panel) closes it.
        if (e.target === dialog.current) close();
      }}
      onKeyDown={(e) => trapFocus(e, dialog.current)}
    >
      <div className="yi-palette-panel">
        <div className="yi-palette-field">
          <Search size={17} aria-hidden="true" />
          <input
            ref={input}
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current ? optionId(current) : undefined}
            aria-label="Search instruments, channels, videos and pages, or paste a YouTube link"
            placeholder="Search tickers, channels, videos — or paste a YouTube link"
            value={query}
            maxLength={300}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="yi-text-button yi-palette-close" onClick={close}>
            Esc
          </button>
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="yi-palette-list">
          {groups.map((g) => (
            <li key={g.group} role="presentation">
              <p className="yi-palette-group" id={`yi-qs-group-${g.group}`} aria-hidden="true">
                {g.group === "Recent" ? "Recent searches" : g.group}
              </p>
              <ul role="group" aria-labelledby={`yi-qs-group-${g.group}`}>
                {g.items.map((item) => {
                  const selected = item === current;
                  return (
                    <li
                      key={item.id}
                      id={optionId(item)}
                      role="option"
                      aria-selected={selected}
                      className={selected ? "yi-palette-option yi-active" : "yi-palette-option"}
                      onMouseMove={() => setActive(items.indexOf(item))}
                      onClick={(e) => void choose(item, e.metaKey || e.ctrlKey)}
                    >
                      <span className="yi-palette-label">{item.label}</span>
                      {item.detail && <span className="yi-palette-detail">{item.detail}</span>}
                      {selected && (
                        <span className="yi-palette-hint" aria-hidden="true">
                          {item.analyse ? (busy ? "Analysing…" : "↵ Analyse") : item.altHref ? "↵ Search · ⌘↵ Trends" : item.query !== undefined ? "↵ Use" : "↵ Open"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        <p className="yi-palette-status" role="status" aria-live="polite">
          {status}
        </p>
      </div>
    </dialog>
  );
}
function optionId(item: PaletteItem) {
  return `yi-qs-${item.id.replace(/[^\w-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`;
}
