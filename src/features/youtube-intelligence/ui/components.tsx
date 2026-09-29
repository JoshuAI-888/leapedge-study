"use client";
import { resolveListing } from "../identity.ts";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { ClaimRow } from "../../../server/youtube-intelligence/repos/claims.ts";
import { renderHover, metric } from "../metrics/registry.ts";
import { trustNames, localClaimId } from "./viewmodel.ts";
import { useWorkspace } from "./workspace.tsx";
import { action } from "./api.ts";
import { InstrumentLabel } from "./InstrumentLabel.tsx";
import {
  expiryStatus,
  formatLevel,
  parseLevel,
  type ParsedLevel,
} from "../level-parse.ts";
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="yi-empty">
      <span aria-hidden="true">◇</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function PageTitle({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="yi-page-title">
      <div>
        <p className="yi-eyebrow">YOUTUBE INTELLIGENCE</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </header>
  );
}
export function TrustBadge({
  level,
  basis,
}: {
  level: string;
  basis?: unknown;
}) {
  const rejected =
    basis !== null &&
    typeof basis === "object" &&
    "latestReviewVerdict" in basis &&
    basis.latestReviewVerdict === "rejected";
  const details: Record<string, string> = {
    L0: "Extracted with structural checks. Not yet checked against a second source.",
    L1: "Evidence and deterministic checks passed; the text critic accepted this claim.",
    L2: "Caption and audio agree on the cited evidence above the configured threshold.",
    L3: "A named human reviewer listened to the cited span and signed the claim.",
  };
  return (
    <span
      tabIndex={0}
      className={`yi-chip ${rejected ? "yi-trust-rejected" : `yi-trust-${level}`}`}
      title={
        rejected
          ? "A signed reviewer rejected this exact evidence; excluded from scoring."
          : (details[level] ?? details.L0)
      }
    >
      {rejected ? "Human rejected" : (trustNames[level] ?? "Extracted")}
    </span>
  );
}
export function ConvictionChip({ value }: { value: string }) {
  return <span className="yi-chip yi-conviction">Conviction: {value}</span>;
}
export function MetricHeading({
  id,
  onSort,
  direction,
}: {
  id: string;
  onSort?: () => void;
  direction?: "asc" | "desc";
}) {
  return (
    <th
      scope="col"
      aria-sort={
        direction ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        title={renderHover(id)}
        onClick={onSort}
        disabled={!onSort}
      >
        {metric(id).label}
        {direction ? (direction === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}
export function Filters({ children }: { children: ReactNode }) {
  return <div className="yi-filters">{children}</div>;
}
const LEVEL_KINDS: Record<string, string> = {
  entry: "Entry",
  target: "Target",
  stop: "Stop",
  support: "Support",
  resistance: "Resistance",
  strike: "Strike",
};
type LevelInput = {
  kind: string;
  value_original?: string;
  valueOriginal?: string;
  parsed?: ParsedLevel | null;
};
/**
 * Level chips (F60): the kind and the application's reading of the number,
 * with the creator's wording in the hover. A level the parser could not read
 * shows the original text with a dotted underline; no number is invented.
 * A kind said more than once is numbered ("Target 1", "Target 2").
 */
export function LevelChips({ levels }: { levels: LevelInput[] }) {
  if (!levels.length) return null;
  const totals = new Map<string, number>();
  for (const l of levels) totals.set(l.kind, (totals.get(l.kind) ?? 0) + 1);
  const seen = new Map<string, number>();
  return (
    <ul className="yi-card2-levels" aria-label="Levels">
      {levels.map((l, i) => {
        const original = l.valueOriginal ?? l.value_original ?? "";
        const parsed =
          l.parsed === undefined ? parseLevel(original) : l.parsed;
        const n = (seen.get(l.kind) ?? 0) + 1;
        seen.set(l.kind, n);
        const kind = `${LEVEL_KINDS[l.kind] ?? l.kind}${(totals.get(l.kind) ?? 0) > 1 ? ` ${n}` : ""}`;
        return (
          <li
            key={i}
            className={`yi-card2-level${parsed ? "" : " yi-card2-unparsed"}`}
            title={
              parsed
                ? `Said as "${original}" · read as ${formatLevel(parsed)}`
                : `Said as "${original}" · no number could be read from this wording`
            }
          >
            <em>{kind}</em>
            <span>{parsed ? formatLevel(parsed) : original}</span>
          </li>
        );
      })}
    </ul>
  );
}
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** "expires 31 Oct (32 days)", amber within 7 days, "expired" once past. */
export function ExpiryBadge({
  date,
  original,
}: {
  date: string | null | undefined;
  original: string | null | undefined;
}) {
  const status = expiryStatus(date, todayLocal());
  if (!status)
    return original ? (
      <span className="yi-card2-expiry" title="Expiry as the creator said it">
        expires: {original}
      </span>
    ) : null;
  const shown = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const text =
    status.state === "expired"
      ? `expired ${shown}`
      : `expires ${shown} (${status.days === 0 ? "today" : `${status.days} day${status.days === 1 ? "" : "s"}`})`;
  return (
    <span
      className={`yi-card2-expiry yi-card2-expiry-${status.state}`}
      title={original ? `Said as "${original}"` : undefined}
      suppressHydrationWarning
    >
      {text}
    </span>
  );
}
export function ClaimCard({
  claim,
  selected = false,
  onSelect,
}: {
  claim: ClaimRow;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const listing = resolveListing(claim.instrument, claim.ticker);
  const levels = claim.levels ?? [];
  const catalysts = claim.catalystsEn ?? [];
  const extras = claim.risksEn.length + claim.conditionsEn.length;
  return (
    <article className={`yi-claim yi-card2 ${selected ? "yi-selected" : ""}`}>
      <div className="yi-row yi-card2-line1">
        <InstrumentLabel
          claim={{
            ticker: listing?.ticker ?? claim.ticker,
            instrument: claim.instrument,
            macroTheme: claim.macroTheme,
          }}
        />
        <span className={`yi-chip yi-stance-${claim.stance}`}>
          {claim.stance}
        </span>
        <ConvictionChip value={claim.creatorConviction} />
        <TrustBadge level={claim.trustLevel} basis={claim.trustBasis} />
        {(claim.horizonEn || claim.expiryDate || claim.expiryOriginal) && (
          <span className="yi-card2-when">
            {claim.horizonEn && <span>{claim.horizonEn}</span>}
            <ExpiryBadge
              date={claim.expiryDate}
              original={claim.expiryOriginal}
            />
          </span>
        )}
      </div>
      {listing && listing.ticker !== claim.ticker && (
        <p className="yi-muted">
          Listing match: {listing.name} · {listing.exchange}. Source
          name/ticker: {claim.instrument}
          {claim.ticker ? ` / ${claim.ticker}` : " (source ticker unconfirmed)"}
          .{" "}
          <a href={listing.sourceUrl} target="_blank" rel="noreferrer">
            Identity source
          </a>
        </p>
      )}
      <h3>{claim.thesisEn}</h3>
      {claim.actionEn && (
        <p className="yi-card2-action">
          <span>Action</span> {claim.actionEn}
        </p>
      )}
      <LevelChips levels={levels} />
      {catalysts.length > 0 && (
        <div className="yi-card2-catalysts">
          <span>Catalysts</span>
          {catalysts.map((c, i) => (
            <span key={i} className="yi-chip">
              {c}
            </span>
          ))}
        </div>
      )}
      {extras > 0 && (
        <details className="yi-card2-more">
          <summary>
            {[
              claim.risksEn.length
                ? `Risks (${claim.risksEn.length})`
                : "",
              claim.conditionsEn.length
                ? `Conditions (${claim.conditionsEn.length})`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </summary>
          {claim.risksEn.length > 0 && (
            <>
              <h4>Risks</h4>
              <ul>
                {claim.risksEn.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </>
          )}
          {claim.conditionsEn.length > 0 && (
            <>
              <h4>Conditions</h4>
              <ul>
                {claim.conditionsEn.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
      <footer>
        <Link
          href={`/youtube-intelligence/analysis/${encodeURIComponent(claim.runId)}#${encodeURIComponent(claim.id)}`}
          onClick={onSelect}
        >
          Inspect evidence ↗
        </Link>
        <SaveCallButton claim={claim} />
      </footer>
    </article>
  );
}
export function BenchmarkSelector() {
  const { data, perform, busy } = useWorkspace();
  const [customMode, setCustomMode] = useState(false),
    [customTicker, setCustomTicker] = useState<string | null>(null);
  if (!data) return null;
  const stored = data.preferences.resolved.benchmark;
  const isCustom = customMode || stored.startsWith("custom:");
  return (
    <div className="yi-benchmark">
      <label>
        Benchmark
        <select
          disabled={busy}
          value={isCustom ? "custom" : stored}
          onChange={(e) => {
            const value = e.target.value;
            setCustomMode(value === "custom");
            if (value !== "custom")
              void perform(
                () =>
                  action("settings", "saveAccount", {
                    ...data.preferences.account,
                    benchmark: value,
                  }),
                "Benchmark saved.",
              );
          }}
        >
          <option>SPY</option>
          <option>QQQ</option>
          <option>IWM</option>
          <option value="sector-etf">Sector ETF</option>
          <option value="none">No benchmark</option>
          <option value="custom">Custom ticker</option>
        </select>
      </label>
      {isCustom && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const ticker = (customTicker ?? stored.replace(/^custom:/, ""))
              .trim()
              .toUpperCase();
            void perform(
              () =>
                action("settings", "saveAccount", {
                  ...data.preferences.account,
                  benchmark: `custom:${ticker}`,
                }),
              "Custom benchmark saved.",
            );
          }}
        >
          <label>
            Benchmark ticker
            <input
              required
              pattern="[A-Z0-9.\^=\-]{1,20}"
              maxLength={20}
              value={
                customTicker ??
                (stored.startsWith("custom:") ? stored.slice(7) : "")
              }
              onChange={(e) => setCustomTicker(e.target.value.toUpperCase())}
              placeholder="e.g. VTI"
            />
          </label>
          <button className="yi-secondary" disabled={busy}>
            Apply benchmark
          </button>
        </form>
      )}
    </div>
  );
}
export function Collapsible({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="yi-details">
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}
export function NoteEditor({
  initial,
  save,
}: {
  initial: string;
  save: (note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState(initial);
  const [saving, setSaving] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        await save(note);
        setSaving(false);
      }}
    >
      <label>
        Research note
        <textarea
          value={note}
          maxLength={4000}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
        />
      </label>
      <button disabled={saving || note === initial}>
        {saving ? "Saving…" : "Save note"}
      </button>
      <span className="yi-muted"> {note.length}/4,000</span>
    </form>
  );
}

export function SaveCallButton({ claim }: { claim: ClaimRow }) {
  const { data, perform, busy } = useWorkspace();
  const existing = data?.snapshot.ideas.find((i) => i.id === claim.id);
  const saved = existing && existing.status !== "dismissed";
  return (
    <button
      className="yi-text-button"
      disabled={busy}
      onClick={() =>
        void perform(
          () =>
            existing
              ? action("research", "idea", {
                  id: claim.id,
                  status: saved ? "dismissed" : "open",
                  note: String(existing.note ?? ""),
                })
              : action("research", "saveIdea", {
                  runId: claim.runId,
                  claimId: localClaimId(claim.id, claim.runId),
                }),
          saved ? "Call removed from Saved." : "Call saved.",
        )
      }
    >
      {saved ? "✓ Saved · remove" : "+ Save call"}
    </button>
  );
}
