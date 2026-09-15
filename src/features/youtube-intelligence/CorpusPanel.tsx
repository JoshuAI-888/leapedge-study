"use client";
import { useState } from "react";
import { entityCorpus, type EntityData } from "./entities";
import type { Run } from "./contracts";
export function CorpusPanel({
  runs,
  entities,
  busy,
  act,
}: {
  runs: Run[];
  entities: EntityData[];
  busy: boolean;
  act: (action: string, data: unknown) => Promise<unknown>;
}) {
  const [query, setQuery] = useState(""),
    [type, setType] = useState(""),
    [editing, setEditing] = useState<EntityData | null>(null);
  const groups = entityCorpus(runs, entities).filter(
    (g) =>
      (!type || g.entity.type === type) &&
      `${g.entity.name} ${g.entity.ticker || ""} ${g.entity.topics.join(" ")} ${g.rows.map((r) => r.item.claim.thesis_en).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="panel research-panel">
      <h2>Instruments & topics</h2>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => act("suggestEntities", null)}
      >
        Suggest English classifications (up to 30; uses model budget)
      </button>
      <p>
        Research grouped by entity, including contextual key points.
        Classification suggestions are separate from verified trading claims.
        Repeated claims are not independent consensus.
      </p>
      <div className="inline-form">
        <input
          aria-label="Search corpus"
          placeholder="English name, ticker, topic or thesis"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Entity type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">All types</option>
          {[
            "Company",
            "ETF",
            "Index",
            "Macro",
            "Sector",
            "Theme",
            "Commodity",
            "Unresolved",
          ].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      {!groups.length && <p>No matching accepted research.</p>}
      {groups.map((g) => (
        <section className="panel corpus-card" key={g.entity.id}>
          <h3>
            {g.entity.name}{" "}
            {g.entity.ticker ? `· ${g.entity.exchange}:${g.entity.ticker}` : ""}
          </h3>
          <p>
            {g.entity.type} · {g.entity.status} · {g.rows.length} evidence items
            · {new Set(g.rows.map((r) => r.run.videoId)).size} videos ·{" "}
            {
              new Set(
                g.rows.map((r) =>
                  String(
                    (r.run.output.metadata as { channel?: string })?.channel ||
                      "Unknown",
                  ),
                ),
              ).size
            }{" "}
            channels
          </p>
          <p>{g.entity.topics.join(" · ")}</p>
          <p>{g.entity.resolutionNote}</p>
          <button
            className="secondary"
            onClick={() =>
              setEditing({
                ...g.entity,
                id: g.entity.id.startsWith("unresolved:")
                  ? "entity-" + Date.now()
                  : g.entity.id,
              })
            }
          >
            Classify / correct identity
          </button>
          <details>
            <summary>Claims, conditions and disagreements</summary>
            {g.rows.map(({ run, item }) => (
              <article className="research-row" key={`${run.id}:${item.id}`}>
                <div>
                  <strong>
                    {item.claim.stance} · {item.claim.creator_conviction}{" "}
                    creator conviction
                  </strong>
                  <p>{item.claim.thesis_en}</p>
                  <p>{item.claim.conditions_en.join(" · ")}</p>
                  <small>
                    {String(
                      (run.output.metadata as { channel?: string })?.channel ||
                        "Unknown channel",
                    )}{" "}
                    · {run.createdAt.slice(0, 10)} · Text checked; audio
                    unverified
                  </small>
                  <p>
                    <a href={`/?run=${run.id}`}>Open source report</a>
                  </p>
                </div>
              </article>
            ))}
          </details>
        </section>
      ))}
      {editing && (
        <form
          className="panel"
          key={editing.id}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await act("entity", {
              id: editing.id,
              name: f.get("name"),
              type: f.get("type"),
              aliases: String(f.get("aliases"))
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
              topics: String(f.get("topics"))
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
              ticker: String(f.get("ticker")).trim() || null,
              exchange: String(f.get("exchange")).trim() || null,
              status: "reviewed",
              resolutionNote: f.get("note"),
            });
          }}
        >
          <h3>Review entity classification</h3>
          <label>
            English display name
            <input name="name" required defaultValue={editing.name} />
          </label>
          <label>
            Type
            <select name="type" defaultValue={editing.type}>
              {[
                "Company",
                "ETF",
                "Index",
                "Macro",
                "Sector",
                "Theme",
                "Commodity",
                "Unresolved",
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Original aliases (one per line; retained for matching)
            <textarea
              name="aliases"
              defaultValue={editing.aliases.join("\n")}
            />
          </label>
          <label>
            English topics (comma-separated)
            <input name="topics" defaultValue={editing.topics.join(", ")} />
          </label>
          <label>
            Verified ticker, optional
            <input name="ticker" defaultValue={editing.ticker || ""} />
          </label>
          <label>
            Exchange, required with ticker
            <input name="exchange" defaultValue={editing.exchange || ""} />
          </label>
          <label>
            Identity evidence / correction reason
            <textarea
              required
              minLength={5}
              name="note"
              defaultValue={editing.resolutionNote}
            />
          </label>
          <button className="secondary" disabled={busy}>
            Save reviewed classification
          </button>
          <button type="button" onClick={() => setEditing(null)}>
            Close
          </button>
        </form>
      )}
      {editing && entities.some((e) => e.id === editing.id) && (
        <form
          className="panel corpus-card"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            act("entityMerge", {
              sourceId: editing.id,
              targetId: f.get("target"),
              reason: f.get("reason"),
            });
          }}
        >
          <h3>Merge a duplicate identity</h3>
          <p>
            Preserves claims and records both original classifications in the
            audit history. Distinct listings and incompatible types are
            rejected.
          </p>
          <label>
            Keep this entity
            <select name="target" required>
              <option value="">Choose the canonical identity</option>
              {entities
                .filter((e) => e.id !== editing.id)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {e.type}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Reason for merging
            <textarea name="reason" required minLength={10} />
          </label>
          <button className="secondary" disabled={busy}>
            Merge with audit record
          </button>
        </form>
      )}
    </section>
  );
}
