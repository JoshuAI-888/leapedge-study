"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PROCESSING_PROFILES, ProcessingProfileSetting } from "../../processing-profiles.ts";
import { useWorkspace, type Preferences } from "../workspace.tsx";
import { action } from "../api.ts";
import { money } from "../viewmodel.ts";
import { PageTitle } from "../components.tsx";
const labels: Record<string, string> = {
  monthlyUsd: "Monthly budget (US$)",
  perVideoMaxUsd: "Maximum per video (US$)",
  alertAtPercent: "Alert at (%)",
  parallelVideos: "Parallel videos",
  unknownOutcomeHoldMinutes: "Unknown outcome hold (minutes)",
  minimumLevelForToday: "Minimum trust on Today",
  minSettledForRank: "Minimum settled calls for ranking",
  minSettledPerTicker: "Minimum settled calls per ticker",
  fdrQ: "False discovery rate",
  id: "Model identifier",
  default: "Default transport",
};
const choices: Record<string, string[]> = {
  transport: ["google-native", "openrouter"],
  default: ["google-native", "openrouter"],
  thinkingBudget: ["low", "medium", "high"],
  captionProvider: ["transcriptapi", "none"],
  standby: ["supadata", "none"],
  standbyPlan: ["free", "basic", "pro", "mega"],
  asr: ["gemini-windowed", "gemini-file", "off"],
  asrPolicy: ["always", "when-captions-missing", "on-demand"],
  mediaResolution: ["low", "default"],
  userSubmitted: ["immediate", "batch"],
  channelUploads: ["immediate", "batch"],
  discovery: ["push", "poll"],
  minimumLevelForToday: ["text-checked", "audio-agreed", "human-verified"],
  minimumTrust: ["text-checked", "audio-agreed", "human-verified"],
};
const title = (key: string) =>
  labels[key] ??
  key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
function ListInput({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const serialized = values.join(", "),
    [text, setText] = useState(serialized);
  useEffect(() => setText(serialized), [serialized]);
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() =>
        onChange(
          text
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        )
      }
    />
  );
}
function ObjectFields({
  value,
  onChange,
  path = "",
}: {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  path?: string;
}) {
  return (
    <div className="yi-settings-fields">
      {Object.entries(value).map(([key, item]) => {
        if (
          [
            "selection",
            "efficiencyProfile",
            "context",
            "corpus",
            "sharing",
            "lab",
            "contextCaching",
            "seedDefaults",
            "defaultSelection",
            "autoAnalyzeNewChannels",
            "requireDifferentFamily",
          ].includes(key)
        )
          return null;
        const update = (next: unknown) => onChange({ ...value, [key]: next });
        if (item !== null && typeof item === "object" && !Array.isArray(item))
          return (
            <fieldset key={key}>
              <legend>{title(key)}</legend>
              <ObjectFields
                value={item as Record<string, unknown>}
                onChange={update}
                path={`${path}.${key}`}
              />
            </fieldset>
          );
        if (typeof item === "boolean")
          return (
            <label className="yi-checkbox" key={key}>
              <input
                type="checkbox"
                checked={item}
                onChange={(e) => update(e.target.checked)}
              />
              {title(key)}
            </label>
          );
        return (
          <label key={key}>
            {title(key)}
            {choices[key] ? (
              <select
                value={String(item)}
                onChange={(e) => update(e.target.value)}
              >
                {choices[key].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            ) : Array.isArray(item) ? (
              <ListInput values={item.map(String)} onChange={update} />
            ) : (
              <input
                required
                type={
                  typeof item === "number"
                    ? "number"
                    : key === "from"
                      ? "date"
                      : "text"
                }
                step={typeof item === "number" ? "any" : undefined}
                value={String(item ?? "")}
                onChange={(e) =>
                  update(
                    typeof item === "number"
                      ? e.target.value === ""
                        ? ""
                        : Number(e.target.value)
                      : e.target.value,
                  )
                }
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
export function Settings() {
  const { data, busy, perform } = useWorkspace();
  const [team, setTeam] = useState<Preferences["team"] | null>(null),
    [account, setAccount] = useState<Preferences["account"] | null>(null);
  if (!data) return null;
  const t = team ?? data.preferences.team,
    a = account ?? data.preferences.account,
    b = data.cost.budget;
  return (
    <>
      <PageTitle
        title="Settings"
        description="Your view preferences and the team's processing controls."
      />
      <section className="yi-panel">
        <div className="yi-section-title">
          <h2>Monthly budget</h2>
          <strong>
            {money(b.committedUsd)} / {money(b.monthlyUsd)}
          </strong>
        </div>
        <meter
          min={0}
          max={Math.max(b.effectiveLimitUsd, 1)}
          value={Math.min(
            b.conservativeCommittedUsd,
            Math.max(b.effectiveLimitUsd, 1),
          )}
          aria-label="Monthly spending and reservations"
        />
        <div className="yi-budget-grid">
          <p>
            Settled this month<strong>{money(b.monthToDateSpentUsd)}</strong>
          </p>
          <p>
            Open holds<strong>{money(b.openHoldsUsd)}</strong>
          </p>
          <p>
            Hard ceiling
            <strong>
              {b.hardCeilingUsd === null
                ? "Not configured"
                : money(b.hardCeilingUsd)}
            </strong>
          </p>
          <p>
            Available<strong>{money(b.remainingUsd)}</strong>
          </p>
        </div>
        {b.unallocatedSpentUsd > 0 && (
          <p className="yi-warning">
            {money(b.unallocatedSpentUsd)} in older undated charges is
            conservatively held against available budget.
          </p>
        )}
        {b.state !== "within-budget" && (
          <p className="yi-warning">
            {b.state.replaceAll("-", " ")}. Open holds include uncertain
            provider outcomes.
          </p>
        )}
      </section>
      <form
        className="yi-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void perform(
            () => action("settings", "saveAccount", a),
            "Your preferences were saved.",
          ).then((ok) => {
            if (ok) setAccount(null);
          });
        }}
      >
        <h2>Leaderboard and sentiment</h2>
        <p className="yi-muted">
          Blank overrides inherit the team's defaults. These change your view
          without changing stored results.
        </p>
        <div className="yi-settings-fields">
          <label>
            Benchmark
            <select
              value={a.benchmark ?? ""}
              onChange={(e) =>
                setAccount({
                  ...a,
                  benchmark: (e.target.value || null) as typeof a.benchmark,
                })
              }
            >
              <option value="">
                Team default ({data.preferences.resolved.benchmark})
              </option>
              {["SPY", "QQQ", "IWM", "sector-etf", "none"].map((v) => (
                <option key={v}>{v}</option>
              ))}
              {a.benchmark?.startsWith("custom:") && (
                <option value={a.benchmark}>{a.benchmark}</option>
              )}
              <option value="custom:">Custom ticker…</option>
            </select>
          </label>
          {a.benchmark?.startsWith("custom:") && (
            <label>
              Custom benchmark ticker
              <input
                required
                pattern="[A-Z0-9.\^=\-]{1,20}"
                maxLength={20}
                value={a.benchmark.slice(7)}
                onChange={(e) =>
                  setAccount({
                    ...a,
                    benchmark: `custom:${e.target.value.toUpperCase()}`,
                  })
                }
              />
            </label>
          )}
          <label>
            Horizon
            <select
              value={a.defaultHorizonDays ?? ""}
              onChange={(e) =>
                setAccount({
                  ...a,
                  defaultHorizonDays: (e.target.value
                    ? Number(e.target.value)
                    : null) as typeof a.defaultHorizonDays,
                })
              }
            >
              <option value="">Team default</option>
              {[90, 180, 365].map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </select>
          </label>
          <label>
            Sentiment period
            <select
              value={a.sentiment.periodDays ?? ""}
              onChange={(e) =>
                setAccount({
                  ...a,
                  sentiment: {
                    ...a.sentiment,
                    periodDays: (e.target.value
                      ? Number(e.target.value)
                      : null) as typeof a.sentiment.periodDays,
                  },
                })
              }
            >
              <option value="">Team default</option>
              {[7, 14, 30].map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </select>
          </label>
          <label>
            Markets
            <ListInput
              values={a.marketFilter ?? data.preferences.resolved.marketFilter}
              onChange={(values) =>
                setAccount({
                  ...a,
                  marketFilter: values as typeof a.marketFilter,
                })
              }
            />
            <small>us-stock, us-etf, hk, cn-a, other</small>
          </label>
          <label>
            Appearance
            <select
              value={a.display.theme}
              onChange={(e) =>
                setAccount({
                  ...a,
                  display: {
                    ...a.display,
                    theme: e.target.value as typeof a.display.theme,
                  },
                })
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>
            Today minimum trust
            <select
              value={a.todayTrustFilter ?? ""}
              onChange={(e) =>
                setAccount({
                  ...a,
                  todayTrustFilter: (e.target.value ||
                    null) as typeof a.todayTrustFilter,
                })
              }
            >
              <option value="">Team default</option>
              {["text-checked", "audio-agreed", "human-verified"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Change window
            <select
              value={a.changeWindowDays ?? ""}
              onChange={(e) =>
                setAccount({
                  ...a,
                  changeWindowDays: e.target.value
                    ? (Number(e.target.value) as 30)
                    : null,
                })
              }
            >
              <option value="">Team default</option>
              {[7, 14, 30, 90, 180].map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="yi-row">
          <button disabled={busy || !account}>Save my preferences</button>
          <button
            type="button"
            className="yi-secondary"
            disabled={busy}
            onClick={() =>
              setAccount({
                ...a,
                benchmark: null,
                defaultHorizonDays: null,
                changeWindowDays: null,
                todayTrustFilter: null,
                marketFilter: null,
                sentiment: { ...a.sentiment, periodDays: null },
              })
            }
          >
            Use team defaults
          </button>
          <button
            type="button"
            className="yi-text-button"
            disabled={!account}
            onClick={() => setAccount(null)}
          >
            Discard
          </button>
        </div>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perform(
            () => action("settings", "saveTeam", t),
            "Team configuration saved. New analyses use this version.",
          ).then((ok) => {
            if (ok) setTeam(null);
          });
        }}
      >
        <section className="yi-panel">
          <h2>Team configuration</h2>
          <p className="yi-muted">
            Changing providers, models or prompts affects newly queued analyses.
            Existing results keep their original configuration. The critic must
            always use a different model family from extraction.
          </p>
          <fieldset className="yi-panel">
            <legend>Processing profile</legend>
            <div className="yi-settings-fields">
              <label>
                Profile for new analyses
                <select
                  value={t.processing.efficiencyProfile ?? "deployment-default"}
                  aria-describedby="yi-processing-profile-description yi-processing-profile-scope"
                  disabled={busy}
                  onChange={(e) => setTeam({
                    ...t,
                    processing: {
                      ...t.processing,
                      efficiencyProfile: ProcessingProfileSetting.parse(e.target.value),
                    },
                  })}
                >
                  {PROCESSING_PROFILES.map((profile) => (
                    <option key={profile.value} value={profile.value}>{profile.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <p id="yi-processing-profile-description" className="yi-muted" aria-live="polite">
              {PROCESSING_PROFILES.find(profile => profile.value === (t.processing.efficiencyProfile ?? "deployment-default"))?.description}
            </p>
            <p id="yi-processing-profile-scope" className="yi-muted">
              Save team configuration to apply this workspace setting to new analyses.
              Existing and already queued analyses keep their original profile.
              Every profile preserves evidence, references and required audits.
            </p>
            {t.processing.efficiencyProfile === "experimental-overlap" ? (
              <p className="yi-warning">Experimental research overlap may add cost. Quality parity has not been established; use Efficient for routine research.</p>
            ) : null}
            <Link href="/youtube-intelligence/processing-profiles">Compare processing profiles and safeguards</Link>
          </fieldset>
          <ObjectFields
            value={t as unknown as Record<string, unknown>}
            onChange={(v) => setTeam(v as unknown as Preferences["team"])}
          />
          <div className="yi-sticky-actions">
            <button
              type="button"
              className="yi-secondary"
              onClick={() => setTeam(data.preferences.defaults)}
            >
              Reset to product defaults
            </button>
            <button disabled={busy || !team}>Save team configuration</button>
            <button
              className="yi-secondary"
              type="button"
              disabled={!team}
              onClick={() => setTeam(null)}
            >
              Discard changes
            </button>
          </div>
        </section>
      </form>
    </>
  );
}
