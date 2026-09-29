"use client";
import { useEffect, useId, useRef, useState } from "react";
import { read } from "./api.ts";
import { LARGE_EXPORT, exportScope } from "../export-columns.ts";

type ExportFile = {
  filename: string;
  contentType: string;
  body: string;
  rows: number;
  total: number;
  truncated: boolean;
};

/**
 * The Export menu (F63): "Export ▾" with CSV and JSON. It states what it
 * exports ("41 calls matching these filters"), is disabled when nothing
 * matches, builds the file on the server (query/export pages through every
 * match, up to 20,000) and saves it in the browser as a Blob. Past 5,000 rows
 * it says it is preparing the file while the server works.
 */
export function ExportMenu({
  input,
  total,
  filtered = true,
}: {
  /** The query/calls filters and sort, without limit or offset. */
  input: Record<string, unknown>;
  total: number;
  filtered?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"csv" | "json" | null>(null);
  const [message, setMessage] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const scope = exportScope(total, filtered);
  useEffect(() => {
    if (!open) return;
    const first = menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]");
    first?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && e.target !== button.current) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);
  async function download(format: "csv" | "json") {
    setOpen(false);
    button.current?.focus();
    setBusy(format);
    setMessage(total > LARGE_EXPORT ? "Preparing export…" : "");
    try {
      const file = await read<ExportFile>("query", "export", { ...input, format });
      const url = URL.createObjectURL(new Blob([file.body], { type: file.contentType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        file.truncated
          ? `Saved the first ${file.rows.toLocaleString("en-US")} of ${file.total.toLocaleString("en-US")} calls. Narrow the filters for the rest.`
          : `Saved ${file.rows.toLocaleString("en-US")} ${file.rows === 1 ? "call" : "calls"} as ${format.toUpperCase()}.`,
      );
    } catch (e) {
      setMessage(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }
  function onMenuKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  }
  return (
    <div className="yi-export">
      <button
        ref={button}
        type="button"
        className="yi-secondary yi-export-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        disabled={total === 0 || busy !== null}
        title={total === 0 ? "Nothing to export: no calls match these filters" : scope}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? (total > LARGE_EXPORT ? "Preparing export…" : "Exporting…") : "Export ▾"}
      </button>
      {open && (
        <div ref={menu} id={`${id}-menu`} role="menu" aria-label={`Export ${scope}`} className="yi-export-menu" onKeyDown={onMenuKey}>
          <p className="yi-export-scope">{scope}</p>
          <button type="button" role="menuitem" onClick={() => void download("csv")}>
            CSV <span className="yi-muted">spreadsheet</span>
          </button>
          <button type="button" role="menuitem" onClick={() => void download("json")}>
            JSON <span className="yi-muted">with evidence spans</span>
          </button>
        </div>
      )}
      <span className="yi-export-status" role="status" aria-live="polite">
        {message}
      </span>
    </div>
  );
}
