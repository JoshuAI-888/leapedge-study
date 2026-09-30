"use client";
import { useCallback, useEffect, useState } from "react";
import {
  PRESCREEN_EXPLANATION,
  ERROR_TYPES,
  type JevComparisonData,
} from "../faithfulness-prescreen.ts";
import type { TeamPreferencesData } from "../settings.ts";
import { action } from "./api.ts";
import { money } from "./viewmodel.ts";

type Screen = TeamPreferencesData["faithfulnessPreScreen"];

/** The toggle and its explanation; saved with the rest of the team configuration. */
export function JevPreScreenSetting({
  value,
  disabled,
  onChange,
}: {
  value: Screen;
  disabled: boolean;
  onChange: (next: Screen) => void;
}) {
  return (
    <fieldset className="yi-panel">
      <legend>Faithfulness pre-screen (Jev)</legend>
      <label className="yi-checkbox">
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={disabled}
          aria-describedby="yi-prescreen-what"
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        Screen sentences with Jev before the Claude critic
      </label>
      <p id="yi-prescreen-what" className="yi-muted">{PRESCREEN_EXPLANATION.what}</p>
      <p className="yi-eyebrow">Why this helps</p>
      <ul className="yi-muted">
        {PRESCREEN_EXPLANATION.why.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="yi-eyebrow">What to know</p>
      <ul className="yi-muted">
        {PRESCREEN_EXPLANATION.limits.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <div className="yi-settings-fields">
        <label>
          Accept at or above
          <input
            type="number" min={0.5} max={1} step={0.01} disabled={disabled}
            value={value.acceptAtOrAbove}
            onChange={(e) => onChange({ ...value, acceptAtOrAbove: Number(e.target.value) })}
          />
        </label>
        <label>
          Withhold at or below
          <input
            type="number" min={0} max={0.5} step={0.01} disabled={disabled}
            value={value.rejectAtOrBelow}
            onChange={(e) => onChange({ ...value, rejectAtOrBelow: Number(e.target.value) })}
          />
        </label>
        <label>
          Jev model
          <input
            required pattern="jev-[a-z0-9.\-]{1,40}" disabled={disabled}
            value={value.model}
            onChange={(e) => onChange({ ...value, model: e.target.value })}
          />
        </label>
      </div>
      <p className="yi-muted">
        Off by default. Applies to new analyses on the v3 faithful brief pipeline once the team configuration is saved;
        existing briefs keep the check they had. The defaults (0.8 and 0.15, jev-1.13.0) are the tuned settings.
      </p>
    </fieldset>
  );
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Ad hoc Jev vs LLM critic comparison on one existing brief. */
export function JevComparisonPanel({
  briefs,
  defaultCritic,
}: {
  briefs: { id: string; title: string; createdAt: string }[];
  defaultCritic: string;
}) {
  const [chosen, setBriefId] = useState("");
  const briefId = chosen || briefs[0]?.id || "";
  const [critic, setCritic] = useState(defaultCritic);
  const [results, setResults] = useState<JevComparisonData[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setResults(await action<JevComparisonData[]>("research", "jevComparisons"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load comparisons.");
    }
  }, []);
  useEffect(() => void load(), [load]);
  const sorted = [...(results ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const waiting = pending !== null && !sorted.some((c) => c.briefId === pending && Date.parse(c.createdAt) > Date.now() - 3_600_000);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [waiting, load]);
  const run = async () => {
    setError("");
    try {
      await action("research", "requestJevComparison", { briefId, ...(critic.trim() ? { criticModel: critic.trim() } : {}) });
      setPending(briefId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the comparison.");
    }
  };
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="yi-panel" aria-label="Jev versus LLM comparison">
      <h2>Compare Jev with an LLM critic</h2>
      <p className="yi-muted">
        Runs both judges on every sentence of one brief, published and withheld, against the quotes each sentence cites,
        and shows where they agree, what Jev would have settled on its own, and the time and cost of each. Nothing in the
        brief changes. It costs one critic pass on that brief plus a fraction of a cent for Jev, and works whether or not
        the pre-screen is switched on.
      </p>
      <div className="yi-settings-fields">
        <label>
          Brief
          <select value={briefId} onChange={(e) => setBriefId(e.target.value)}>
            {briefs.map((b) => (
              <option key={b.id} value={b.id}>{b.title} · {b.createdAt.slice(0, 10)}</option>
            ))}
          </select>
        </label>
        <label>
          LLM critic model
          <input value={critic} maxLength={120} onChange={(e) => setCritic(e.target.value)} />
          <small>The team critic by default. Uses the critic&apos;s transport.</small>
        </label>
      </div>
      <div className="yi-row">
        <button type="button" disabled={!briefId || waiting} onClick={() => void run()}>
          {waiting ? "Comparison running…" : "Run comparison"}
        </button>
        {!briefs.length && <span className="yi-muted">No research briefs yet.</span>}
      </div>
      {error && <p className="yi-warning">{error}</p>}
      {sorted.map((c) => {
        const s = c.summary;
        const settled = s.jevAccepted + s.jevRejected;
        return (
          <div key={c.id} className="yi-panel">
            <h3>{c.briefTitle}</h3>
            <p className="yi-muted">
              {c.createdAt.slice(0, 16).replace("T", " ")} · {c.jevModel} vs {c.criticModel} · band {c.band.rejectAtOrBelow} / {c.band.acceptAtOrAbove}
            </p>
            <div className="yi-budget-grid">
              <p>Jev settled alone<strong>{settled} of {s.compared} ({pct(settled, s.compared)})</strong></p>
              <p>Agreed with the critic when settled<strong>{s.settledAgreeing} of {settled}</strong></p>
              <p>Jev accepted, critic rejected<strong>{s.jevAcceptedCriticRejected}</strong></p>
              <p>Jev withheld, critic accepted<strong>{s.jevRejectedCriticAccepted}</strong></p>
              <p>Jev time and cost<strong>{seconds(c.jev.wallMs)} · {money(c.jev.costUsd)}</strong></p>
              <p>Critic time and cost<strong>{seconds(c.critic.wallMs)} · {money(c.critic.costUsd)}</strong></p>
            </div>
            {s.jevAcceptedCriticRejected > 0 && (
              <p className="yi-warning">
                Jev would have published {s.jevAcceptedCriticRejected} sentence(s) the critic rejected. Read those rows before relying on the pre-screen.
              </p>
            )}
            {(c.jev.error || c.critic.failures > 0) && (
              <p className="yi-warning">
                {c.jev.error ?? ""} {c.critic.failures ? `${c.critic.failures} critic check(s) failed; those sentences are not compared.` : ""}
              </p>
            )}
            <p className="yi-muted">{c.caveat}</p>
            <button type="button" className="yi-text-button" onClick={() => setOpen(open === c.id ? null : c.id)}>
              {open === c.id ? "Hide sentences" : `Show all ${s.sentences} sentences`}
            </button>
            {open === c.id && (
              <div className="yi-table-wrap">
                <table>
                  <thead>
                    <tr><th>Sentence</th><th>Jev</th><th>Critic</th></tr>
                  </thead>
                  <tbody>
                    {c.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.text}</td>
                        <td>
                          {r.jev ? (
                            <>
                              <strong>{r.jev.route === "accept" ? "Accept" : r.jev.route === "reject" ? "Withhold" : "Unsure → critic"}</strong>{" "}
                              {r.jev.pFaithful.toFixed(2)}
                              {r.jev.errorType !== "none" && <small> · {ERROR_TYPES[r.jev.errorType]}</small>}
                            </>
                          ) : "Not screened"}
                        </td>
                        <td>
                          {r.critic ? (
                            <>
                              <strong>{r.critic.accepted ? "Accept" : "Reject"}</strong> <small>{r.critic.reason}</small>
                            </>
                          ) : "No verdict"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
