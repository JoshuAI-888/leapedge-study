"use client";
import { trendSummary, directionChanges, type ResearchCall } from "./trends";
function Bars({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; count: number }[];
}) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <section className="trend-card">
      <h3>{title}</h3>
      {rows.map((r) => (
        <div className="trend-bar" key={r.label}>
          <span>{r.label}</span>
          <meter
            min={0}
            max={total || 1}
            value={r.count}
            aria-label={`${r.label}: ${r.count} of ${total} claims`}
          />
          <strong>{r.count}</strong>
        </div>
      ))}
      {!rows.length && <p>No matching research yet.</p>}
    </section>
  );
}
export function TrendsPanel({ calls }: { calls: ResearchCall[] }) {
  const stats = trendSummary(calls),
    changes = directionChanges(calls);
  return (
    <section className="research-trends">
      <h2>Research trends</h2>
      <p>
        {calls.length} claims · {stats.videos} videos · {stats.channels}{" "}
        creators. Your filtered collection, grouped by analysis date.
      </p>
      <div className="trend-grid">
        <Bars title="Direction mix" rows={stats.directions} />
        <Bars title="Creator conviction" rows={stats.conviction} />
        <Bars
          title="Most discussed instruments"
          rows={stats.tickers.slice(0, 10)}
        />
        <Bars title="Research activity by day" rows={stats.days.slice(-14)} />
      </div>
      <h3>Direction over time</h3>
      <p>
        Each point opens its evidence. Positions with the same date are listed
        separately below.
      </p>
      <div
        className="direction-chart"
        role="group"
        aria-label="Direction timeline"
      >
        {[
          "long",
          "short",
          "hold",
          "watch",
          "conditional",
          "avoid",
          "neutral",
        ].map((stance) => (
          <div className="direction-lane" key={stance}>
            <strong>{stance}</strong>
            <div>
              {calls
                .filter((c) => c.item.claim.stance === stance)
                .slice()
                .sort((a, b) => a.run.createdAt.localeCompare(b.run.createdAt))
                .map((c) => (
                  <a
                    className={`direction-point conviction-${c.item.claim.creator_conviction}`}
                    key={c.run.id + c.item.id}
                    href={`/?run=${c.run.id}`}
                    title={`${c.run.createdAt.slice(0, 10)} · ${c.item.claim.creator_conviction} conviction · ${c.item.claim.thesis_en}`}
                  >
                    <span>
                      {c.item.claim.ticker ||
                        c.item.claim.instrument_as_spoken ||
                        "Macro"}
                    </span>
                    <small>{c.run.createdAt.slice(0, 10)}</small>
                  </a>
                ))}
            </div>
          </div>
        ))}
      </div>
      <h3>Changes to review</h3>
      {!changes.length && (
        <p>No cross-video direction changes in this selection.</p>
      )}
      {changes.map((c) => (
        <article key={c.current.run.id + c.current.item.id}>
          <strong>
            {c.current.item.claim.ticker ||
              c.current.item.claim.instrument_as_spoken}
            : {c.previous.item.claim.stance} → {c.current.item.claim.stance}
          </strong>
          <p>{c.label}</p>
          <p>{c.current.item.claim.thesis_en}</p>
          <a href={`/?run=${c.previous.run.id}`}>Earlier evidence</a>
          {" · "}
          <a href={`/?run=${c.current.run.id}`}>Later evidence</a>
        </article>
      ))}
    </section>
  );
}
