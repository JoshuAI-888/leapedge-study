import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SourceSpan } from "../src/features/youtube-intelligence/contracts.ts";
import { sentimentFromStance } from "../src/features/youtube-intelligence/sentiment.ts";
import {
  Conviction,
  GOLD_SET_VERSION,
  GoldCase,
  Language,
  Sentiment,
  Split,
  Stance,
  claimKey,
  parseGoldSet,
  type GoldCaseData,
  type GoldClaimData,
  type GoldRejectionData,
  type GoldSetData,
} from "../evaluations/gold-set/schema.ts";
/**
 * Draft gold cases from exported runs, for a human to verify (spec 4.9).
 *
 *   node --experimental-strip-types scripts/gold-draft.ts
 *     --runs <runs.json> --out <gold-draft.json>
 *     [--split development|held_out] [--json]
 *
 * The input is what scripts/export-runs.ts writes: a JSON array of run rows.
 * Each completed run becomes one pending case whose expectations are copied
 * out of the stored output — the accepted claims with their ticker, stance,
 * conviction and sentiment, the span of their first pointer evidence, and the
 * run's non-call mentions as expected rejections. Nothing is written that the
 * run did not already record: no reviewer, no review date, no anchor. Every
 * span arrives anchorVerified false and every case status pending, because a
 * drafted expectation is a worklist entry, not ground truth; scripts/
 * gold-validate.ts lists what each case still needs.
 *
 * A run that cannot be represented is skipped whole rather than half-drafted
 * (an accepted claim with no ticker, a language that is neither en nor zh, an
 * output that carries nothing to draft) and every skip is printed with its
 * reason, so the human sees what to re-run or annotate by hand. The draft is
 * checked with parseGoldSet before anything is written, so the file this
 * produces is always one the gold-set harness and the promotion gate accept.
 *
 * Determinism: the same runs file always yields the same draft, so re-drafting
 * over a reviewed file shows only the changes the runs made. No clock, no
 * database, no network, no keys. Bad flags and an unreadable runs file exit 2;
 * a draft the schema rejects exits 1 and writes nothing.
 */
export const GOLD_DRAFT_VERSION = "gold-draft.v1";
export const USAGE = [
  "Usage:",
  "  node --experimental-strip-types scripts/gold-draft.ts --runs <runs.json> --out <gold-draft.json>",
  "    [--split development|held_out] [--json]",
  "",
  "  --runs <runs.json>    runs exported by scripts/export-runs.ts (required)",
  "  --out <file>          where to write the draft gold set (required)",
  "  --split <split>       the split every drafted case carries (default development)",
  "  --json                print the summary object instead of the report",
  "",
  "  Exit status: 0 written, 1 the draft does not validate, 2 bad flags or an unreadable file.",
].join("\n");

/** A bad command line, or a runs file that cannot be read: the caller exits 2. */
export class FlagError extends Error {
  override name = "FlagError";
}

/** A draft the gold-set schema rejects: the caller exits 1 and writes nothing. */
export class DraftError extends Error {
  override name = "DraftError";
}

/**
 * The row shape scripts/export-runs.ts writes, replicated here on purpose:
 * this script reads that file without importing the exporter, whose module
 * opens a database, so the two shapes are pinned by tests on both sides.
 */
export const RunRow = z.object({
  id: z.string().min(1),
  videoId: z.string().min(1),
  url: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  title: z.string(),
  status: z.string(),
  stage: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().nullable(),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
  cost: z.number(),
});
export type RunRowData = z.infer<typeof RunRow>;

/**
 * What this script reads out of output.claims and output.mentions: the fields
 * a gold expectation is made of, and nothing else. Unrelated fields and
 * unrelated refinements are ignored, so one legacy quote claim cannot cost a
 * run its case; the enums come from the contracts so they cannot drift.
 */
const CheckedClaimRow = z.object({
  id: z.string().min(1),
  passed: z.boolean(),
  claim: z.object({
    ticker: z.string().nullable().default(null),
    stance: Stance,
    creator_conviction: Conviction,
    sentiment: z.unknown().optional(),
    evidence: z
      .array(
        z.object({
          quote_original: z.string().default(""),
          source_span: z.unknown().optional(),
        }),
      )
      .default([]),
  }),
});
const MentionRow = z.object({
  ticker: z.string().nullable().default(null),
  instrument_as_spoken: z.string().min(1),
  stance: Stance,
  sentiment: Sentiment,
  rationale_en: z.string().min(1),
  is_call: z.boolean(),
  claim_id: z.string().nullable().default(null),
});
type CheckedClaimRowData = z.infer<typeof CheckedClaimRow>;

export type SplitValue = z.infer<typeof Split>;
export type LanguageValue = z.infer<typeof Language>;
export type GoldDraftOptions = {
  runsPath: string;
  out: string;
  split: SplitValue;
  json: boolean;
};
export type DraftSkip = {
  runId: string;
  videoId: string;
  reason: string;
};
export type DraftOutcome = {
  /** The drafted case, or null when the run was skipped. */
  case: GoldCaseData | null;
  reason: string | null;
};
export type GoldDraftResult = {
  version: string;
  runsPath: string | null;
  runsRead: number;
  set: GoldSetData;
  cases: GoldCaseData[];
  skipped: DraftSkip[];
};

const VIDEO_ID = /^[\w-]{11}$/;
/** GoldClaim.ticker: the gold set holds a symbol, not a sentence. */
const TICKER_LIMIT = 12;

/** Parse the command line. Pure: no file is read. */
export function parseOptions(argv: string[]): GoldDraftOptions {
  let runsPath: string | null = null;
  let out: string | null = null;
  let split: SplitValue | null = null;
  let json = false;
  const value = (flag: string, i: number) => {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--"))
      throw new FlagError(`${flag} needs a value.`);
    return next;
  };
  const once = (flag: string, seen: boolean) => {
    if (seen) throw new FlagError(`${flag} was given twice.`);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--runs") {
      once(arg, runsPath !== null);
      runsPath = value(arg, i++);
    } else if (arg === "--out") {
      once(arg, out !== null);
      out = value(arg, i++);
    } else if (arg === "--split") {
      once(arg, split !== null);
      const parsed = Split.safeParse(value(arg, i++));
      if (!parsed.success)
        throw new FlagError("--split takes development or held_out.");
      split = parsed.data;
    } else if (arg === "--json") {
      once(arg, json);
      json = true;
    } else if (arg.startsWith("-")) {
      throw new FlagError(`unknown flag: ${arg}`);
    } else {
      throw new FlagError(`unexpected argument: ${arg}`);
    }
  }
  if (runsPath === null) throw new FlagError("--runs <runs.json> is required.");
  if (out === null) throw new FlagError("--out <gold-draft.json> is required.");
  return { runsPath, out, split: split ?? "development", json };
}

/** Read and validate an exported runs file; anything unreadable is a FlagError. */
export function readRunRows(path: string): RunRowData[] {
  let text: string;
  try {
    text = readFileSync(resolve(path), "utf8");
  } catch (e) {
    throw new FlagError(`--runs ${path}: ${(e as Error).message}`);
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (e) {
    throw new FlagError(`--runs ${path}: ${(e as Error).message}`);
  }
  const rows = z.array(RunRow).safeParse(document);
  if (!rows.success)
    throw new FlagError(
      `--runs ${path} is not a run export: ${issueText(rows.error)}`,
    );
  return rows.data;
}

function issueText(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.map((p) => String(p)).join(".") || "<root>"}: ${i.message}`)
    .join(" | ");
}

/** The language the run recorded, as written: output.source first, then metadata. */
export function recordedLanguage(output: Record<string, unknown>): string | null {
  const source = output.source as { language?: unknown } | undefined;
  const metadata = output.metadata as { language?: unknown } | undefined;
  for (const value of [source?.language, metadata?.language])
    if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

/** A recorded language tag as a gold-set language, or null when it is neither. */
export function goldLanguage(recorded: string | null): LanguageValue | null {
  if (!recorded) return null;
  const parsed = Language.safeParse(recorded.toLowerCase().split(/[-_]/)[0]);
  return parsed.success ? parsed.data : null;
}

/**
 * The span of the claim's first usable pointer evidence: the seconds the
 * pointer carries and the text the application copied for it. Legacy quote
 * evidence and a pointer with no timestamps yield null — a pending claim may
 * carry no span, and the reviewer locates the audio.
 */
export function claimSpan(claim: CheckedClaimRowData["claim"]) {
  for (const evidence of claim.evidence) {
    const span = SourceSpan.safeParse(evidence.source_span);
    if (!span.success) continue;
    const { start_seconds: start, end_seconds: end } = span.data;
    if (typeof start !== "number" || typeof end !== "number" || end <= start) continue;
    if (!evidence.quote_original) continue;
    return { startSeconds: start, endSeconds: end, text: evidence.quote_original };
  }
  return null;
}

/**
 * One pending case from one run, or a reason it was skipped. The sentiment of
 * an expectation is the run's own: the mention the pipeline linked to the
 * claim, else a sentiment the claim carries, else the stance table (spec 4.13).
 */
export function draftCase(
  row: RunRowData,
  options: { split: SplitValue },
): DraftOutcome {
  const skip = (reason: string): DraftOutcome => ({ case: null, reason });
  if (row.status !== "completed") return skip(`status is ${row.status}, not completed`);
  if (!VIDEO_ID.test(row.videoId))
    return skip(`videoId ${row.videoId} is not an 11-character YouTube id`);
  const claims = z.array(CheckedClaimRow).safeParse(row.output.claims ?? []);
  if (!claims.success)
    return skip(`output.claims is not a checked-claim list: ${issueText(claims.error)}`);
  const mentions = z.array(MentionRow).safeParse(row.output.mentions ?? []);
  if (!mentions.success)
    return skip(`output.mentions is not a mention list: ${issueText(mentions.error)}`);
  const recorded = recordedLanguage(row.output);
  const language = goldLanguage(recorded);
  if (!language)
    return skip(
      recorded
        ? `recorded language ${recorded} is neither en nor zh`
        : "no language in output.source or output.metadata",
    );

  const expectedClaims: GoldClaimData[] = [];
  const byKey = new Map<string, string>();
  for (const candidate of claims.data.filter((c) => c.passed)) {
    const ticker = candidate.claim.ticker?.trim();
    if (!ticker)
      return skip(`claim ${candidate.id} names no ticker, so no expectation can be drafted`);
    if (ticker.length > TICKER_LIMIT)
      return skip(
        `claim ${candidate.id} ticker ${ticker} is longer than ${TICKER_LIMIT} characters`,
      );
    const key = claimKey(ticker, candidate.claim.stance);
    const clash = byKey.get(key);
    if (clash)
      return skip(
        `claims ${clash} and ${candidate.id} share ticker ${ticker} and stance ${candidate.claim.stance}`,
      );
    byKey.set(key, candidate.id);
    // The same reading evaluations/gold-set/report.ts:83-86 takes of an observed
    // claim: its own sentiment, else the stance. Never the linked mention's —
    // the evaluator does not look there, so preferring it would draft an
    // expectation that disagrees with the run it was drafted from.
    const own = Sentiment.safeParse(candidate.claim.sentiment);
    expectedClaims.push({
      id: candidate.id,
      ticker,
      stance: candidate.claim.stance,
      creator_conviction: candidate.claim.creator_conviction,
      sentiment: own.success
        ? own.data
        : sentimentFromStance(candidate.claim.stance),
      span: claimSpan(candidate.claim),
      anchorVerified: false,
      reviewer: "",
      reviewedAt: "",
    });
  }
  // Every mention the run recorded must appear somewhere. A call whose claim is
  // in expectedClaims is already covered; a call whose claim the critique
  // rejected is not, and dropping it silently would hide it from the reviewer.
  const draftedClaimIds = new Set(expectedClaims.map((c) => c.id));
  const expectedRejections: GoldRejectionData[] = mentions.data.flatMap((m, i) => {
    const covered = m.is_call && m.claim_id !== null && draftedClaimIds.has(m.claim_id);
    if (covered) return [];
    const reason = m.is_call
      ? `${m.instrument_as_spoken} is a ${m.sentiment} call (stance ${m.stance}) the run recorded but did not accept as a claim: ${m.rationale_en}`
      : `${m.instrument_as_spoken} is a ${m.sentiment} mention (stance ${m.stance}) the run did not extract as a call: ${m.rationale_en}`;
    return [
      {
        id: `m${i + 1}`,
        ticker: m.ticker?.trim() ? m.ticker.trim() : null,
        reason,
      },
    ];
  });
  if (!expectedClaims.length && !expectedRejections.length)
    return skip("output has no accepted claim and no mention to draft");
  const ids = [...expectedClaims, ...expectedRejections].map((x) => x.id);
  if (new Set(ids).size !== ids.length)
    return skip("the run's claim and mention ids collide");

  const notes = [
    `Drafted from run ${row.id}; no expectation here has been checked against the audio.`,
    `Run output: ${claims.data.length} candidate claim(s), ${expectedClaims.length} accepted, ${mentions.data.length} mention(s) of which ${expectedRejections.length} are not calls.`,
  ];
  for (const claim of expectedClaims)
    if (!claim.span)
      notes.push(`Claim ${claim.id} has no pointer span; locate the audio on review.`);
  if (expectedRejections.length)
    notes.push(
      "Each expected rejection is a mention the run did not call; confirm a claim there would be wrong before verifying.",
    );
  const drafted = {
    id: `draft-${row.videoId}`,
    videoId: row.videoId,
    language,
    split: options.split,
    status: "pending",
    review: null,
    // Run id and prompt version only. A drafted case is committed, and the run
    // export the id points at already records which model produced it.
    source: `run ${row.id} (${row.promptVersion})`,
    notes,
    expectedClaims,
    expectedRejections,
  };
  const parsed = GoldCase.safeParse(drafted);
  if (!parsed.success)
    return skip(`the drafted case does not validate: ${issueText(parsed.error)}`);
  return { case: parsed.data, reason: null };
}

/**
 * Draft every completed run in file order, newest run per video: two completed
 * runs of one video are one case, because a gold set holds one expectation per
 * video, and the run left out is reported as a skip. The result is checked with
 * parseGoldSet, so a caller that gets a result has a valid gold set.
 */
export function draftGoldSet(
  rows: RunRowData[],
  options: { split: SplitValue; runsPath?: string | null },
): GoldDraftResult {
  const cases: GoldCaseData[] = [];
  const positionOf = new Map<string, number>();
  const keptRun = new Map<string, RunRowData>();
  const skipped: DraftSkip[] = [];
  for (const row of rows) {
    const outcome = draftCase(row, options);
    if (!outcome.case) {
      skipped.push({
        runId: row.id,
        videoId: row.videoId,
        reason: outcome.reason ?? "skipped",
      });
      continue;
    }
    const position = positionOf.get(row.videoId);
    const kept = keptRun.get(row.videoId);
    if (position === undefined || kept === undefined) {
      positionOf.set(row.videoId, cases.length);
      keptRun.set(row.videoId, row);
      cases.push(outcome.case);
      continue;
    }
    const newer = row.createdAt > kept.createdAt;
    const dropped = newer ? kept : row;
    if (newer) {
      cases[position] = outcome.case;
      keptRun.set(row.videoId, row);
    }
    skipped.push({
      runId: dropped.id,
      videoId: dropped.videoId,
      reason: `run ${newer ? row.id : kept.id} is a newer completed run for this video`,
    });
  }
  const runsPath = options.runsPath ?? null;
  const document = {
    version: GOLD_SET_VERSION,
    attribution: [
      `Drafted by scripts/gold-draft.ts (${GOLD_DRAFT_VERSION}) from ${
        runsPath ? basename(runsPath) : "exported runs"
      }: one case per completed run, every expectation copied from the stored run output.`,
      "Every case is pending and every anchorVerified is false: nothing here is ground truth. Reviewers check each span against the audio, fill in the reviewer and review date, and flip status to verified.",
    ],
    cases,
  };
  let set: GoldSetData;
  try {
    set = parseGoldSet(document);
  } catch (e) {
    throw new DraftError((e as Error).message);
  }
  return {
    version: GOLD_DRAFT_VERSION,
    runsPath,
    runsRead: rows.length,
    set,
    cases: set.cases,
    skipped,
  };
}

/** Write the draft where --out asked for it, creating the directory if needed. */
export function writeDraft(set: GoldSetData, out: string): string {
  const path = resolve(out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(set, null, 2) + "\n");
  return path;
}

/** The counts a script or a log wants: read, drafted, skipped with reasons. */
export function summary(result: GoldDraftResult, out: string | null = null) {
  return {
    version: result.version,
    runsPath: result.runsPath,
    out,
    runsRead: result.runsRead,
    casesDrafted: result.cases.length,
    runsSkipped: result.skipped.length,
    expectedClaims: result.cases.reduce((n, c) => n + c.expectedClaims.length, 0),
    claimsWithSpan: result.cases.reduce(
      (n, c) => n + c.expectedClaims.filter((x) => x.span).length,
      0,
    ),
    expectedRejections: result.cases.reduce((n, c) => n + c.expectedRejections.length, 0),
    skipped: result.skipped,
  };
}

/** The per-case table, then one line per skipped run, then the totals. */
export function formatReport(result: GoldDraftResult, out: string | null = null): string {
  const header = ["case", "videoId", "lang", "split", "claims", "spans", "rejections"];
  const body = result.cases.map((c) => [
    c.id,
    c.videoId,
    c.language,
    c.split,
    String(c.expectedClaims.length),
    String(c.expectedClaims.filter((x) => x.span).length),
    String(c.expectedRejections.length),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i].length), 1),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  const t = summary(result, out);
  const label = (text: string, value: string) => `  ${text.padEnd(22)}${value}`;
  return [
    `gold draft from ${result.runsPath ?? "exported runs"}: ${result.cases.length} case(s)`,
    "",
    line(header),
    line(widths.map((w) => "-".repeat(w))),
    ...body.map(line),
    "",
    `skipped ${result.skipped.length} run(s)`,
    ...(result.skipped.length
      ? result.skipped.map((s) => `  ${s.runId} (${s.videoId}): ${s.reason}`)
      : ["  none"]),
    "",
    "totals",
    label("runs read", String(t.runsRead)),
    label("cases drafted", String(t.casesDrafted)),
    label("runs skipped", String(t.runsSkipped)),
    label("expected claims", `${t.expectedClaims} (${t.claimsWithSpan} with a span)`),
    label("expected rejections", String(t.expectedRejections)),
    label("anchors verified", "0 (a person verifies every anchor)"),
    ...(out ? [label("wrote", out)] : []),
  ].join("\n");
}

function main() {
  let options: GoldDraftOptions;
  let result: GoldDraftResult;
  try {
    options = parseOptions(process.argv.slice(2));
    result = draftGoldSet(readRunRows(options.runsPath), {
      split: options.split,
      runsPath: options.runsPath,
    });
  } catch (e) {
    if (e instanceof FlagError) {
      console.error(`scripts/gold-draft.ts: ${e.message}\n\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    if (e instanceof DraftError) {
      console.error(`scripts/gold-draft.ts: ${e.message}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
  const out = writeDraft(result.set, options.out);
  if (options.json) console.log(JSON.stringify(summary(result, out), null, 2));
  else console.log(formatReport(result, out));
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
