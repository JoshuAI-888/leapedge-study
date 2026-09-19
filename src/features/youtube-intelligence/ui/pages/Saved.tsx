"use client";
import Link from "next/link";
import { useState } from "react";
import { useWorkspace } from "../workspace.tsx";
import { action } from "../api.ts";
import {
  Empty,
  Filters,
  NoteEditor,
  PageTitle,
  TrustBadge,
} from "../components.tsx";
import { dateLabel } from "../viewmodel.ts";
import type { ClaimData } from "../../contracts.ts";
export function Saved() {
  const { data, perform, busy } = useWorkspace();
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("open");
  if (!data) return null;
  const ideas = data.snapshot.ideas
    .filter(
      (i) =>
        i.status === status &&
        `${JSON.stringify(i.claim)} ${String(i.note)}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  return (
    <>
      <PageTitle
        title="Saved calls"
        description="Your research notebook: the calls worth revisiting, and why."
      />
      <Filters>
        <label>
          Find saved research
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ticker, thesis or note"
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Open</option>
            <option value="done">Reviewed</option>
            <option value="dismissed">Removed</option>
          </select>
        </label>
      </Filters>
      <p className="yi-muted">Newest saved first.</p>
      {ideas.length ? (
        <div className="yi-card-grid">
          {ideas.map((i) => {
            const claim = i.claim as ClaimData;
            const current = data.snapshot.claims.find((c) => c.id === i.id);
            return (
              <article className="yi-panel" key={String(i.id)}>
                <div className="yi-row">
                  <strong className="yi-ticker">
                    {claim.ticker ||
                      claim.instrument_as_spoken ||
                      "Unresolved instrument"}
                  </strong>
                  <span className={`yi-chip yi-stance-${claim.stance}`}>
                    {claim.stance}
                  </span>
                  {current && <TrustBadge level={current.trustLevel} />}
                </div>
                <h3>{claim.thesis_en}</h3>
                <p className="yi-muted">
                  Saved {dateLabel(String(i.savedAt))} ·{" "}
                  {String(i.channel || i.title || "")}
                </p>
                <NoteEditor
                  initial={String(i.note || "")}
                  save={(note) =>
                    perform(
                      () =>
                        action("research", "idea", {
                          id: i.id,
                          status: i.status,
                          note,
                        }),
                      "Note saved.",
                    )
                  }
                />
                <footer className="yi-row">
                  <Link href={`/youtube-intelligence/analysis/${i.runId}`}>
                    View evidence ↗
                  </Link>
                  <button
                    className="yi-secondary"
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        () =>
                          action("research", "idea", {
                            id: i.id,
                            status: status === "open" ? "done" : "open",
                            note: i.note || "",
                          }),
                        "Saved call updated.",
                      )
                    }
                  >
                    {status === "open" ? "Mark reviewed" : "Restore to open"}
                  </button>
                  {status !== "dismissed" && (
                    <button
                      className="yi-text-button"
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          () =>
                            action("research", "idea", {
                              id: i.id,
                              status: "dismissed",
                              note: i.note || "",
                            }),
                          "Removed from saved calls.",
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty title="No saved calls in this view">
          Save a call from Today or an analysis. Its source evidence stays
          attached.
        </Empty>
      )}
    </>
  );
}
