"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { ClaimRow } from "../../../server/youtube-intelligence/repos/claims.ts";
import { renderHover, metric } from "../metrics/registry.ts";
import { trustNames, localClaimId } from "./viewmodel.ts";
import { useWorkspace } from "./workspace.tsx";
import { action } from "./api.ts";
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
export function ClaimCard({
  claim,
  selected = false,
  onSelect,
}: {
  claim: ClaimRow;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <article className={`yi-claim ${selected ? "yi-selected" : ""}`}>
      <div className="yi-row">
        <span className="yi-ticker">
          {claim.ticker ?? claim.instrument ?? "Unresolved instrument"}
        </span>
        <span className={`yi-chip yi-stance-${claim.stance}`}>
          {claim.stance}
        </span>
        <TrustBadge level={claim.trustLevel} basis={claim.trustBasis} />
      </div>
      <h3>{claim.thesisEn}</h3>
      <div className="yi-row">
        <ConvictionChip value={claim.creatorConviction} />
        <span className="yi-muted">
          {claim.horizonEn || "Horizon not specified"}
        </span>
      </div>
      {claim.conditionsEn.length > 0 && (
        <p>
          <strong>Conditions:</strong> {claim.conditionsEn.join(" · ")}
        </p>
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
