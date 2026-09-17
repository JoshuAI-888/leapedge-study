import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CASES_PATH,
  GoldSet,
  MINIMUM_VERIFIED_CASES,
  parseGoldSet,
  type GoldCaseData,
} from "../evaluations/gold-set/schema.ts";
/**
 * Validate the gold cases file and say, in plain language, how far the human
 * review has got (spec 4.9; build plan T4).
 *
 *   node --experimental-strip-types scripts/gold-validate.ts
 *     [--cases evaluations/gold-set/cases.json] [--json] [--strict]
 *
 * The file is loaded with parseGoldSet, so this command accepts exactly what
 * the gold-set harness and the promotion gate accept. When the schema rejects
 * it, every problem is printed as "<json path>: <message>" and the command
 * exits 1 — nothing else is reported, because a malformed file has no
 * trustworthy counts.
 *
 * When it parses, each case is printed with its id, video, language, split,
 * status and its claim, anchor and rejection counts, and a case that is not
 * yet verified lists the specific conditions it still needs:
 *
 *   - status verified,
 *   - a case-level review with a reviewer and an ISO reviewedAt,
 *   - at least one expected claim or rejection,
 *   - every expected claim anchorVerified, with a span and its own reviewer
 *     and ISO reviewedAt.
 *
 * Those are the rules evaluations/gold-set/schema.ts enforces for a verified
 * case; this command applies them to pending cases too, as a worklist. It
 * reads one file and writes nothing: no database, no network, no keys.
 *
 * --json prints the same summary as JSON for a script to read.
 * --strict exits 1 while fewer than MINIMUM_VERIFIED_CASES cases are
 * verified, so a build step can hold the line the gate is advisory about.
 * Bad flags and an unreadable cases file exit 2.
 */
export const GOLD_VALIDATE_VERSION = "gold-validate.v1";
export const USAGE = [
  "Usage:",
  "  node --experimental-strip-types scripts/gold-validate.ts [--cases <cases.json>] [--json] [--strict]",
  "",
  `  --cases <cases.json>  the gold cases file (default ${DEFAULT_CASES_PATH})`,
  "  --json                print the summary object instead of the report",
  `  --strict              exit 1 unless ${MINIMUM_VERIFIED_CASES} cases are verified`,
  "",
  "  Exit status: 0 valid, 1 malformed (or --strict unmet), 2 bad flags.",
].join("\n");

/** A bad command line, or a cases file that cannot be read: the caller exits 2. */
export class FlagError extends Error {
  override name = "FlagError";
}

export type GoldValidateOptions = {
  casesPath: string;
  json: boolean;
  strict: boolean;
};
export type GoldIssue = {
  /** The dotted path into the JSON document, or "<root>" for the document itself. */
  path: string;
  message: string;
};
export type GoldCaseSummary = {
  id: string;
  videoId: string;
  language: string;
  split: string;
  status: string;
  claims: number;
  /** Expected claims a person has anchored: anchorVerified with a span. */
  anchoredClaims: number;
  rejections: number;
  verified: boolean;
  /** Empty when the case is verified; otherwise one line per missing condition. */
  missing: string[];
};
export type GoldTotals = {
  cases: number;
  verified: number;
  pending: number;
  minimumVerifiedCases: number;
  remainingToMinimum: number;
  verifiedByLanguage: { en: number; zh: number };
  claims: number;
  anchoredClaims: number;
  rejections: number;
  /** Cases whose whole expectation is a rejection: no expected claims at all. */
  rejectionOnlyVideos: number;
};
export type GoldValidation = {
  version: string;
  ok: boolean;
  goldSetVersion: string | null;
  issues: GoldIssue[];
  cases: GoldCaseSummary[];
  totals: GoldTotals;
};

/** Parse the command line. Pure: no file is read. */
export function parseOptions(argv: string[]): GoldValidateOptions {
  let casesPath: string | null = null;
  let json = false;
  let strict = false;
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
    if (arg === "--cases") {
      once(arg, casesPath !== null);
      casesPath = value(arg, i++);
    } else if (arg === "--json") {
      once(arg, json);
      json = true;
    } else if (arg === "--strict") {
      once(arg, strict);
      strict = true;
    } else if (arg.startsWith("-")) {
      throw new FlagError(`unknown flag: ${arg}`);
    } else {
      throw new FlagError(`unexpected argument: ${arg}`);
    }
  }
  return { casesPath: casesPath ?? DEFAULT_CASES_PATH, json, strict };
}

// A calendar date, optionally with a time and an offset: YYYY-MM-DD[THH:MM[:SS[.sss]][Z|±HH:MM]].
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * True for an ISO 8601 date or timestamp that names a real instant. The schema
 * only asks Date.parse to succeed, which also accepts prose like
 * "March 3, 2026"; a review date a machine has to compare should be ISO.
 */
export function isIsoTimestamp(value: string): boolean {
  const text = value.trim();
  return ISO_TIMESTAMP.test(text) && Number.isFinite(Date.parse(text));
}

function anchored(c: GoldCaseData) {
  return c.expectedClaims.filter((x) => x.anchorVerified && x.span).length;
}

/**
 * Everything standing between this case and "verified", in reading order:
 * the status, the case-level review, the expectations, then each claim.
 * Empty means the case satisfies every rule a verified case must satisfy.
 */
export function verificationGaps(c: GoldCaseData): string[] {
  const missing: string[] = [];
  if (c.status !== "verified") missing.push(`status is ${c.status}, not verified`);
  if (!c.review) missing.push("review is missing");
  else {
    if (!c.review.reviewer.trim()) missing.push("review.reviewer is empty");
    if (!c.review.reviewedAt.trim()) missing.push("review.reviewedAt is missing");
    else if (!isIsoTimestamp(c.review.reviewedAt))
      missing.push(`review.reviewedAt is not an ISO timestamp: ${c.review.reviewedAt}`);
  }
  if (!c.expectedClaims.length && !c.expectedRejections.length)
    missing.push("no expected entries: a verified case needs a claim or a rejection");
  for (const claim of c.expectedClaims) {
    if (!claim.anchorVerified) missing.push(`claim ${claim.id} is not anchorVerified`);
    if (!claim.span) missing.push(`claim ${claim.id} has no span`);
    if (!claim.reviewer.trim()) missing.push(`claim ${claim.id} is missing a reviewer`);
    if (!claim.reviewedAt.trim()) missing.push(`claim ${claim.id} is missing reviewedAt`);
    else if (!isIsoTimestamp(claim.reviewedAt))
      missing.push(
        `claim ${claim.id} reviewedAt is not an ISO timestamp: ${claim.reviewedAt}`,
      );
  }
  return missing;
}

export function caseSummary(c: GoldCaseData): GoldCaseSummary {
  const missing = verificationGaps(c);
  return {
    id: c.id,
    videoId: c.videoId,
    language: c.language,
    split: c.split,
    status: c.status,
    claims: c.expectedClaims.length,
    anchoredClaims: anchored(c),
    rejections: c.expectedRejections.length,
    verified: missing.length === 0,
    missing,
  };
}

function totalsOf(cases: GoldCaseSummary[]): GoldTotals {
  const verified = cases.filter((c) => c.verified);
  const sum = (pick: (c: GoldCaseSummary) => number) =>
    cases.reduce((total, c) => total + pick(c), 0);
  return {
    cases: cases.length,
    verified: verified.length,
    pending: cases.length - verified.length,
    minimumVerifiedCases: MINIMUM_VERIFIED_CASES,
    remainingToMinimum: Math.max(0, MINIMUM_VERIFIED_CASES - verified.length),
    verifiedByLanguage: {
      en: verified.filter((c) => c.language === "en").length,
      zh: verified.filter((c) => c.language === "zh").length,
    },
    claims: sum((c) => c.claims),
    anchoredClaims: sum((c) => c.anchoredClaims),
    rejections: sum((c) => c.rejections),
    rejectionOnlyVideos: cases.filter((c) => c.claims === 0 && c.rejections > 0).length,
  };
}

/**
 * Validate the text of a cases file. Pure and total: a malformed document
 * comes back as `ok: false` with one issue per problem, never as a throw.
 */
export function validateGoldFile(text: string): GoldValidation {
  const empty = {
    version: GOLD_VALIDATE_VERSION,
    ok: false as const,
    goldSetVersion: null,
    cases: [],
    totals: totalsOf([]),
  };
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (e) {
    return { ...empty, issues: [{ path: "<root>", message: (e as Error).message }] };
  }
  let set;
  try {
    set = parseGoldSet(document);
  } catch (e) {
    // The same document, re-checked for the issue list: one path per problem.
    const parsed = GoldSet.safeParse(document);
    const issues = parsed.success
      ? [{ path: "<root>", message: (e as Error).message }]
      : parsed.error.issues.map((i) => ({
          path: i.path.map((p) => String(p)).join(".") || "<root>",
          message: i.message,
        }));
    return { ...empty, issues };
  }
  const cases = set.cases.map(caseSummary);
  return {
    version: GOLD_VALIDATE_VERSION,
    ok: true,
    goldSetVersion: set.version,
    issues: [],
    cases,
    totals: totalsOf(cases),
  };
}

/** Read the cases file and validate it; an unreadable path is a FlagError. */
export function validateGoldPath(path: string): GoldValidation {
  let text: string;
  try {
    text = readFileSync(resolve(path), "utf8");
  } catch (e) {
    throw new FlagError(`--cases ${path}: ${(e as Error).message}`);
  }
  return validateGoldFile(text);
}

/** One line per problem, exactly "<json path>: <message>". */
export function formatIssues(issues: GoldIssue[]): string {
  return issues.map((i) => `${i.path}: ${i.message}`).join("\n");
}

/** The per-case table, the conditions each pending case needs, and the totals. */
export function formatReport(result: GoldValidation): string {
  if (!result.ok) return formatIssues(result.issues);
  const header = [
    "case",
    "videoId",
    "lang",
    "split",
    "status",
    "claims",
    "anchored",
    "rejections",
  ];
  const body = result.cases.map((c) => [
    c.id,
    c.videoId,
    c.language,
    c.split,
    c.status,
    String(c.claims),
    String(c.anchoredClaims),
    String(c.rejections),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i].length), 1),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  const t = result.totals;
  const rows: string[] = [];
  for (let i = 0; i < result.cases.length; i++) {
    rows.push(line(body[i]));
    for (const gap of result.cases[i].missing) rows.push(`    needs: ${gap}`);
  }
  const label = (text: string, value: string) => `  ${text.padEnd(24)}${value}`;
  return [
    `gold set ${result.goldSetVersion}: ${result.cases.length} case(s)`,
    "",
    line(header),
    line(widths.map((w) => "-".repeat(w))),
    ...rows,
    "",
    "totals",
    label("cases", String(t.cases)),
    label(
      "verified",
      `${t.verified} of ${t.minimumVerifiedCases}` +
        (t.remainingToMinimum
          ? ` (${t.remainingToMinimum} more case(s) to review)`
          : " (minimum met)"),
    ),
    label("verified en / zh", `${t.verifiedByLanguage.en} / ${t.verifiedByLanguage.zh}`),
    label("expected claims", String(t.claims)),
    label("anchored claims", String(t.anchoredClaims)),
    label("expected rejections", String(t.rejections)),
    label("rejection-only videos", String(t.rejectionOnlyVideos)),
  ].join("\n");
}

function main() {
  let options: GoldValidateOptions;
  let result: GoldValidation;
  try {
    options = parseOptions(process.argv.slice(2));
    result = validateGoldPath(options.casesPath);
  } catch (e) {
    if (e instanceof FlagError) {
      console.error(`scripts/gold-validate.ts: ${e.message}\n\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    throw e;
  }
  if (options.json) console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    if (!options.json)
      console.error(
        `scripts/gold-validate.ts: ${options.casesPath} is malformed.\n${formatIssues(
          result.issues,
        )}`,
      );
    process.exitCode = 1;
    return;
  }
  if (!options.json) console.log(formatReport(result));
  if (options.strict && result.totals.verified < MINIMUM_VERIFIED_CASES) {
    console.error(
      `scripts/gold-validate.ts: --strict: ${result.totals.verified} of ${MINIMUM_VERIFIED_CASES} required cases are verified; ${result.totals.remainingToMinimum} still need review.`,
    );
    process.exitCode = 1;
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
