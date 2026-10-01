"use client";
import { useState } from "react";
import { atAGlance, headerStance, type AnalystViewData, type IdeaCardData } from "../analyst-view.ts";
import { Collapsible } from "./components.tsx";

const ACTION_LABEL: Record<string, string> = {
  bought: "Bought", sold: "Sold", holding: "Holding", plan_buy: "Plans to buy", plan_sell: "Plans to sell",
  watch: "Watching", research: "Researching", avoid: "Avoid", view: "View",
};
const SENTIMENT_CLASS = { bullish: "yi-stance-long", bearish: "yi-stance-short", mixed: "yi-stance-watch", neutral: "" } as const;
const clock = (s: number | null) =>
  s == null ? null : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function At({ at, onSeek }: { at: number | null; onSeek: (s: number) => void }) {
  const label = clock(at);
  return label ? (
    <button type="button" className="yi-text-button yi-av-at" onClick={() => onSeek(at!)} aria-label={`Play from ${label}`}>
      ▶ {label}
    </button>
  ) : null;
}

function Idea({ idea, onSeek }: { idea: IdeaCardData; onSeek: (s: number) => void }) {
  const who =
    idea.owner === "creator" ? null : `${idea.owner === "guest" ? "Guest" : "Third party"}${idea.ownerName ? `: ${idea.ownerName}` : ""}`;
  const facts: [string, string][] = [];
  if (idea.option)
    facts.push([
      "Option",
      [idea.option.side, idea.option.right, idea.option.strike, idea.option.expiry && `exp. ${idea.option.expiry}`, idea.option.premium && `premium ${idea.option.premium}`]
        .filter(Boolean)
        .join(" "),
    ]);
  if (idea.size) facts.push(["Size", idea.size]);
  for (const l of idea.levels) facts.push([l.kind, `${l.value}${l.condition ? ` — ${l.condition}` : ""}`]);
  if (idea.horizon) facts.push(["Horizon", idea.horizon]);
  if (idea.catalysts.length) facts.push(["Catalysts", idea.catalysts.map((k) => `${k.text}${k.date ? ` (${k.date})` : ""}`).join("; ")]);
  if (idea.conditions.length) facts.push(["Conditions", idea.conditions.join("; ")]);
  if (idea.risks.length) facts.push(["Risks", idea.risks.join("; ")]);
  return (
    <article className={`yi-claim yi-av-idea${idea.owner === "creator" ? "" : " yi-av-third"}`}>
      <div className="yi-row">
        <span className="yi-ticker">{idea.ticker ?? idea.name}</span>
        {idea.action && <span className="yi-chip yi-trust-L2">{ACTION_LABEL[idea.action] ?? idea.action}</span>}
        {headerStance(idea.action, idea.stance) && <span className={`yi-chip yi-stance-${idea.stance}`}>{idea.stance}</span>}
        <span className="yi-chip yi-conviction">conviction {idea.conviction}</span>
        {who && <span className="yi-chip yi-stance-watch">{who}</span>}
      </div>
      {idea.ticker && idea.name !== idea.ticker && (
        <p className="yi-muted yi-av-name">
          {idea.name}
          {idea.spoken && idea.spoken !== idea.name && idea.spoken !== idea.ticker ? ` · said as “${idea.spoken}”` : ""}
        </p>
      )}
      <h3>{idea.thesis}</h3>
      {idea.also.map((a) => (
        <p key={a} className="yi-muted">Also: {a}</p>
      ))}
      {facts.length > 0 && (
        <dl className="yi-levels yi-av-facts">
          {facts.map(([k, v], i) => (
            <div key={i}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {idea.quote && (
        <blockquote className="yi-av-quote">
          “{idea.quote.text}”
          {idea.quote.translation && <span className="yi-muted"> — {idea.quote.translation}</span>}{" "}
          <At at={idea.quote.at} onSeek={onSeek} />
        </blockquote>
      )}
    </article>
  );
}

/** The analyst view: what a PM needs from this video, top to bottom, with pipeline detail folded away. */
export function AnalystViewPanel({ view, note, onSeek }: { view: AnalystViewData; note: string; onSeek: (s: number) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="yi-av" aria-label="Analyst view">
      <div className="yi-panel yi-av-head">
        <div className="yi-section-title">
          <h2>Summary</h2>
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard?.writeText(note).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }
          >
            {copied ? "Copied" : "Copy as note"}
          </button>
        </div>
        <ul className="yi-av-summary">
          {view.summary.map((s, i) => (
            <li key={i}>
              {s.text} <At at={s.at} onSeek={onSeek} />
            </li>
          ))}
        </ul>
        {atAGlance(view) && <p className="yi-av-glance"><strong>At a glance:</strong> {atAGlance(view)}</p>}
        <div className="yi-row">
          {view.themes.map((t) => (
            <span key={t} className="yi-chip yi-av-theme">{t}</span>
          ))}
        </div>
      </div>

      <h2 className="yi-av-h">Ideas</h2>
      {view.ideas.length ? (
        <div className="yi-card-grid">
          {view.ideas.map((i) => (
            <Idea key={i.key} idea={i} onSeek={onSeek} />
          ))}
        </div>
      ) : (
        <p className="yi-muted">No actionable idea was stated in this video; see the key points and sentiment below.</p>
      )}

      {view.sentiment.length > 0 && (
        <>
          <h2 className="yi-av-h">Also discussed</h2>
          <div className="yi-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Sentiment</th>
                  <th>Mentions</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {view.sentiment.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <strong>{r.ticker ?? r.name}</strong>
                      {r.ticker && r.name !== r.ticker && <div className="yi-muted">{r.name}</div>}
                      {r.owner !== "creator" && <div className="yi-muted">third party</div>}
                    </td>
                    <td>
                      <span className={`yi-chip ${SENTIMENT_CLASS[r.sentiment]}`}>{r.sentiment}</span>
                      {r.isCall && <span className="yi-chip">call</span>}
                    </td>
                    <td>{r.mentions}</td>
                    <td className="yi-av-wrap">
                      {r.reasons[0]} <At at={r.firstAt} onSeek={onSeek} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view.otherMentions.length > 0 && (
        <p className="yi-muted">Also mentioned: {view.otherMentions.join(", ")}</p>
      )}

      {view.keyPoints.length > 0 && (
        <div className="yi-panel">
          <h2>Key points</h2>
          <ul>
            {view.keyPoints.map((k, i) => (
              <li key={i}>
                {k.text} <At at={k.at} onSeek={onSeek} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.numbers.length > 0 && (
        <Collapsible title={`Numbers quoted (${view.numbers.length})`}>
          <dl className="yi-levels">
            {view.numbers.map((n, i) => (
              <div key={i}>
                <dt>{n.label}</dt>
                <dd>
                  “{n.quote}” <At at={n.at} onSeek={onSeek} />
                </dd>
              </div>
            ))}
          </dl>
        </Collapsible>
      )}

      {(view.notStated.length > 0 || view.watchOuts.length > 0) && (
        <div className="yi-panel">
          <h2>Watch-outs</h2>
          <ul>
            {view.watchOuts.map((w, i) => (
              <li key={`w${i}`}>
                {w.text} <At at={w.at} onSeek={onSeek} />
              </li>
            ))}
            {view.notStated.map((n, i) => (
              <li key={`n${i}`}>Not stated: {n}</li>
            ))}
          </ul>
        </div>
      )}

      {view.diagnostics.length > 0 && (
        <Collapsible title={`Processing notes (${view.diagnostics.length})`}>
          <ul className="yi-muted">
            {view.diagnostics.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </Collapsible>
      )}
    </section>
  );
}
