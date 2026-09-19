"use client";
import Link from "next/link";
import { AutomationPanel } from "../AutomationPanel.tsx";
import { ComparisonReview } from "../ComparisonReview.tsx";
import { useState } from "react";
import { useWorkspace } from "../workspace.tsx";
import { action } from "../api.ts";
import { Collapsible, Empty, PageTitle } from "../components.tsx";
import { money, processingState, dateLabel } from "../viewmodel.ts";
export function Lab() {
  const { data, perform, busy } = useWorkspace();
  const [left, setLeft] = useState(""),
    [right, setRight] = useState(""),
    [hypothesis, setHypothesis] = useState(""),
    [prompt, setPrompt] = useState(""),
    [baseline, setBaseline] = useState(""),
    [modelA, setModelA] = useState("gemini-3.8-flash"),
    [modelB, setModelB] = useState("gemini-3.5-flash"),
    [experimentHypothesis, setExperimentHypothesis] = useState(""),
    [promptDraft, setPromptDraft] = useState("");
  if (!data) return null;
  return (
    <>
      <PageTitle
        title="Lab"
        description="Compare configurations, inspect diagnostics, and understand the limits of your evidence."
      />
      <div className="yi-two-col">
        <section className="yi-panel">
          <h2>Build checks</h2>
          <p>
            Automated checks cover structural validation, budgets, storage and
            workflow behaviour.
          </p>
          <p className="yi-muted">
            A passing build does not establish real-world extraction accuracy.
            Conformance evidence is recorded with the repository build.
          </p>
        </section>
        <section className="yi-panel">
          <h2>LeapEdge comparison</h2>
          <p>
            Compare outputs from the same video for agreement, omissions and
            usefulness.
          </p>
          <p className="yi-muted">
            Agreement is not independent factual verification. Human gold-set
            minimums are outside this build's scope.
          </p>
        </section>
      </div>
      <section className="yi-panel">
        <h2>Compare stored analyses</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void perform(
              () =>
                action("research", "comparison", {
                  leftId: left,
                  rightId: right,
                  hypothesis,
                }),
              "Comparison created.",
            );
          }}
        >
          <div className="yi-settings-fields">
            <label>
              Baseline
              <select
                required
                value={left}
                onChange={(e) => setLeft(e.target.value)}
              >
                <option value="">Choose an analysis</option>
                {data.snapshot.evaluationRuns.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title || r.videoId} · {r.model}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Candidate
              <select
                required
                value={right}
                onChange={(e) => setRight(e.target.value)}
              >
                <option value="">Choose an analysis</option>
                {data.snapshot.evaluationRuns
                  .filter((r) => r.id !== left)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title || r.videoId} · {r.model}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label>
            What are you testing?
            <textarea
              minLength={5}
              maxLength={4000}
              required
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              placeholder="The extraction change should preserve conditional price levels…"
            />
          </label>
          <button disabled={busy || !left || !right}>Create comparison</button>
        </form>
        {data.snapshot.comparisons.map((c) => (
          <Collapsible key={String(c.id)} title={String(c.hypothesis || c.id)}>
            <pre>{JSON.stringify(c, null, 2)}</pre>
            <ComparisonReview id={String(c.id)} />
          </Collapsible>
        ))}
      </section>
      <section className="yi-panel">
        <h2>Prompt configuration</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void perform(
              () =>
                action("settings", "saveTeam", {
                  ...data.preferences.team,
                  prompts: { version: prompt },
                }),
              "Active prompt version saved.",
            );
          }}
        >
          <label>
            Active prompt
            <select
              value={prompt || data.preferences.team.prompts.version}
              onChange={(e) => setPrompt(e.target.value)}
            >
              {data.snapshot.prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={
              busy ||
              !prompt ||
              prompt === data.preferences.team.prompts.version
            }
          >
            Use for new analyses
          </button>
        </form>
        <Collapsible title="Create a prompt version">
          <p>
            Copy a version, give it a new ID and rationale, then edit its
            instructions. Saved versions are immutable.
          </p>
          <label>
            Start from
            <select
              defaultValue=""
              onChange={(e) => {
                const p = data.snapshot.prompts.find(
                  (p) => p.id === e.target.value,
                );
                if (p)
                  setPromptDraft(
                    JSON.stringify(
                      {
                        ...p,
                        id: `${p.id}.candidate`,
                        rationale: "Describe the intended improvement here.",
                      },
                      null,
                      2,
                    ),
                  );
              }}
            >
              <option value="">Choose a version</option>
              {data.snapshot.prompts.map((p) => (
                <option key={p.id}>{p.id}</option>
              ))}
            </select>
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(
                () => action("settings", "prompt", JSON.parse(promptDraft)),
                "New prompt version saved.",
              );
            }}
          >
            <label>
              Prompt definition
              <textarea
                rows={14}
                required
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
              />
            </label>
            <button disabled={busy || !promptDraft}>Save new version</button>
          </form>
        </Collapsible>
        <Collapsible title="Prompt definitions">
          <pre>{JSON.stringify(data.snapshot.prompts, null, 2)}</pre>
        </Collapsible>
      </section>
      <section className="yi-panel">
        <h2>Start a controlled experiment</h2>
        <p className="yi-muted">
          Two distinct configurations use the same retained source. This queues
          new paid model calls within your budget.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void perform(
              () =>
                action("runs", "experiment", {
                  baselineId: baseline,
                  hypothesis: experimentHypothesis,
                  variants: [modelA, modelB].map((model) => ({
                    model,
                    criticModel: data.preferences.team.models.critique.id,
                    promptVersion:
                      prompt || data.preferences.team.prompts.version,
                  })),
                }),
              "Two experiment variants queued.",
            );
          }}
        >
          <label>
            Retained baseline
            <select
              required
              value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
            >
              <option value="">Choose a completed analysis</option>
              {data.snapshot.evaluationRuns.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title || r.videoId}
                </option>
              ))}
            </select>
          </label>
          <div className="yi-settings-fields">
            <label>
              Extraction model A
              <input
                required
                value={modelA}
                onChange={(e) => setModelA(e.target.value)}
              />
            </label>
            <label>
              Extraction model B
              <input
                required
                value={modelB}
                onChange={(e) => setModelB(e.target.value)}
              />
            </label>
          </div>
          <p className="yi-muted">
            Independent critic: {data.preferences.team.models.critique.id}
          </p>
          <label>
            Hypothesis
            <textarea
              required
              minLength={10}
              maxLength={3000}
              value={experimentHypothesis}
              onChange={(e) => setExperimentHypothesis(e.target.value)}
            />
          </label>
          <button disabled={busy || !baseline || modelA === modelB}>
            Queue experiment
          </button>
        </form>
      </section>
      <section className="yi-panel">
        <h2>Experiments and processing</h2>
        {data.runs.length ? (
          <ul className="yi-list">
            {data.runs.map((r) => (
              <li key={r.id}>
                <div>
                  <Link href={`/youtube-intelligence/analysis/${r.id}`}>
                    {r.title || r.videoId}
                  </Link>
                  <small>
                    {r.model} · {dateLabel(r.createdAt)}
                  </small>
                </div>
                <div>
                  <span className="yi-chip">{processingState(r.status)}</span>
                  <small>{money(r.cost)}</small>
                  <button
                    className="yi-text-button"
                    disabled={busy || r.status !== "completed"}
                    onClick={() =>
                      void perform(
                        () => action("runs", "publishRun", r.id),
                        "Analysis published as the canonical result.",
                      )
                    }
                  >
                    Publish result
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No experiments yet">
            Analyse a video first to create a baseline.
          </Empty>
        )}
        <Collapsible title="Experiment records">
          <pre>{JSON.stringify(data.snapshot.experiments, null, 2)}</pre>
        </Collapsible>
      </section>
      <AutomationPanel />
      <section className="yi-panel">
        <h2>Existing shared snapshots</h2>
        <p className="yi-muted">
          Manage links created by the existing standalone sharing feature. New
          sharing extensions are outside this build.
        </p>
        {data.snapshot.shares.length ? (
          <ul className="yi-list">
            {data.snapshot.shares.map((share) => (
              <li key={String(share.id)}>
                <div>
                  <strong>{String(share.id)}</strong>
                  <small>
                    Created {dateLabel(share.created_at)} ·{" "}
                    {share.revoked_at
                      ? "Revoked"
                      : share.expires_at
                        ? `Expires ${dateLabel(share.expires_at)}`
                        : "No expiry"}
                  </small>
                </div>
                <button
                  disabled={busy || Boolean(share.revoked_at)}
                  onClick={() =>
                    void perform(
                      () => action("briefings", "revoke", String(share.id)),
                      "Shared snapshot revoked.",
                    )
                  }
                >
                  Revoke access
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No shared snapshots">
            Previously created share links will appear here.
          </Empty>
        )}
      </section>
      <Collapsible title="Provider and cost diagnostics">
        <p>
          Connection status reflects server configuration, not a successful
          provider request.
        </p>
        <dl>
          {Object.entries(data.snapshot.integrations).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                {value ? "Configured / enabled" : "Not configured / disabled"}
              </dd>
            </div>
          ))}
        </dl>
        <pre>
          {JSON.stringify(
            {
              calls: data.snapshot.calls,
              captionAttempts: data.snapshot.captionAttempts,
            },
            null,
            2,
          )}
        </pre>
      </Collapsible>
      <Collapsible title="Optional legacy evaluation diagnostics">
        <p>
          Historical diagnostics are retained for comparison and are not a human
          gold-set delivery gate.
        </p>
        <pre>{JSON.stringify(data.snapshot.evaluations, null, 2)}</pre>
      </Collapsible>
    </>
  );
}
