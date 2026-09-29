/**
 * Token counts per model call (F73), assembled from the paid-call ledger
 * (yi_calls, one row per attempt at a stage; store.ts reserve/settle). A
 * settled row's metrics carry the provider's usage: `tokens` (the transport's
 * normalised usage) and `usage` (the provider's own report, where cached
 * tokens live). A figure a row did not record stays null and shows as "—";
 * nothing is estimated.
 */
import { STEPS, stepOfCall } from "./progress-steps.ts";

export type LedgerRow = {
  id?: string;
  run_id?: string;
  stage: string;
  status: string;
  amount: number | string | null;
  attempt?: number | string | null;
  metrics: unknown;
};

export type UsageRow = {
  key: string;
  runId: string | null;
  step: number | null;
  stepLabel: string;
  stage: string;
  attempt: number;
  /** A second or later attempt at the same stage. */
  retry: boolean;
  status: string;
  /** Plain-words note for anything but a completed call. */
  note: string;
  model: string | null;
  inputTokens: number | null;
  cachedTokens: number | null;
  outputTokens: number | null;
  seconds: number | null;
  costUsd: number | null;
};

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const num = (...values: unknown[]) => {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  }
  return null;
};

/** The usage a ledger row's metrics recorded, or nulls. */
export function usageOf(metricsValue: unknown) {
  let metrics = metricsValue;
  if (typeof metrics === "string") {
    try {
      metrics = JSON.parse(metrics);
    } catch {
      metrics = {};
    }
  }
  const m = record(metrics);
  const tokens = record(m.tokens);
  const usage = record(m.usage);
  const details = record(usage.prompt_tokens_details);
  return {
    model: typeof m.model === "string" && m.model ? m.model : null,
    inputTokens: num(
      tokens.inputTokens,
      usage.prompt_tokens,
      usage.promptTokenCount,
    ),
    cachedTokens: num(
      details.cached_tokens,
      usage.cached_tokens,
      usage.cachedContentTokenCount,
      tokens.cachedTokens,
    ),
    outputTokens: num(
      tokens.outputTokens,
      usage.completion_tokens,
      usage.candidatesTokenCount,
    ),
    seconds: num(m.seconds),
  };
}

const NOTES: Record<string, string> = {
  completed: "",
  released: "Failed, not charged",
  reserved: "In progress, amount held",
  unknown: "Outcome unknown, amount held",
};

export function stepLabel(step: number | null) {
  return step === null ? "Other" : STEPS[step - 1].short;
}

/** One row per model call, retries included, in step then attempt order. */
export function callUsageRows(rows: LedgerRow[]): UsageRow[] {
  return rows
    .map((r, index) => {
      const u = usageOf(r.metrics);
      const attempt = Number(r.attempt ?? 1) || 1;
      const step = stepOfCall(r.stage);
      const amount = Number(r.amount);
      return {
        index,
        row: {
          key: r.id ?? `${r.stage}:${attempt}:${index}`,
          runId: r.run_id ?? null,
          step,
          stepLabel: stepLabel(step),
          stage: r.stage,
          attempt,
          retry: attempt > 1,
          status: r.status,
          note: NOTES[r.status] ?? r.status,
          ...u,
          costUsd:
            r.status === "released"
              ? 0
              : Number.isFinite(amount) && amount >= 0
                ? amount
                : null,
        },
      };
    })
    .sort(
      (a, b) =>
        (a.row.step ?? 99) - (b.row.step ?? 99) ||
        a.row.stage.localeCompare(b.row.stage) ||
        a.row.attempt - b.row.attempt ||
        a.index - b.index,
    )
    .map(({ row }) => row);
}

type Summable = Pick<
  UsageRow,
  "inputTokens" | "cachedTokens" | "outputTokens" | "seconds" | "costUsd"
>;
const sum = (rows: Summable[], key: keyof Summable) => {
  const values = rows.map((r) => r[key]).filter((v): v is number => v !== null);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};

/** The total row; a column no call recorded stays null. */
export function usageTotals(rows: Summable[]): Summable & { calls: number } {
  return {
    calls: rows.length,
    inputTokens: sum(rows, "inputTokens"),
    cachedTokens: sum(rows, "cachedTokens"),
    outputTokens: sum(rows, "outputTokens"),
    seconds: sum(rows, "seconds"),
    costUsd: sum(rows, "costUsd"),
  };
}

export type StepAggregate = Summable & {
  step: number | null;
  stepLabel: string;
  calls: number;
  retries: number;
  runs: number;
  /** Cost per analysis that paid for this step. */
  costPerRunUsd: number | null;
};

/** The Lab view: the same columns per step, across runs. */
export function usageByStep(rows: LedgerRow[]): StepAggregate[] {
  const groups = new Map<string, { rows: UsageRow[]; runs: Set<string> }>();
  for (const u of callUsageRows(rows)) {
    const key = String(u.step);
    const g = groups.get(key) ?? { rows: [], runs: new Set<string>() };
    g.rows.push(u);
    if (u.runId) g.runs.add(u.runId);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => {
      const totals = usageTotals(g.rows);
      const step = g.rows[0].step;
      return {
        step,
        stepLabel: stepLabel(step),
        ...totals,
        retries: g.rows.filter((r) => r.retry).length,
        runs: g.runs.size,
        costPerRunUsd:
          totals.costUsd !== null && g.runs.size
            ? totals.costUsd / g.runs.size
            : null,
      };
    })
    .sort((a, b) => (a.step ?? 99) - (b.step ?? 99));
}

/** "84,210" or "—". */
export const tokenText = (n: number | null) =>
  n === null ? "—" : Math.round(n).toLocaleString("en-US");
/** "41 s", "1 min 3 s" or "—". */
export function secondsText(n: number | null) {
  if (n === null) return "—";
  const s = Math.round(n);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
/** "$0.021" with three decimals, since calls cost fractions of a cent; or "—". */
export const costText = (n: number | null) =>
  n === null ? "—" : `$${n.toFixed(3)}`;
