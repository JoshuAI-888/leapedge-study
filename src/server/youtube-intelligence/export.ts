import { z } from "zod";
import {
  queryCallsPage,
  withFilters,
  MAX_PAGE,
  type CallRow,
} from "./repos/research-query.ts";
import {
  EXPORT_CAP,
  EXPORT_COLUMNS,
  type ExportColumn,
} from "../../features/youtube-intelligence/export-columns.ts";
import { sessionFor } from "../../features/youtube-intelligence/trading-day.ts";
import type { ParsedLevel } from "../../features/youtube-intelligence/level-parse.ts";

/**
 * Call exports (F63): pure CSV and JSON writers over query rows (F56), and
 * the `query/export` read that walks every matching page up to a hard cap.
 *
 * CSV is RFC 4180 (comma, CRLF, a field with a comma, quote or line break is
 * quoted and its quotes doubled) with a UTF-8 byte-order mark so spreadsheet
 * apps read CJK text correctly. A cell that starts with = + - @, a tab or a
 * carriage return gets a leading apostrophe, so a spreadsheet shows it as
 * text instead of running it as a formula (OWASP "CSV injection").
 *
 * The footer is the last lines of the file, each starting with "#": the
 * filters, the trust basis, "Trust describes the evidence, not investment
 * quality", and the row count (and whether the file was cut). Starting with
 * "#" lets pandas skip them (`read_csv(..., comment="#")`); a spreadsheet
 * shows them as rows below the data. JSON carries the same facts as fields.
 */
export type ExportMeta = {
  /** The filters in plain words (describeFilters). */
  filters: string;
  exportedAt: string;
  /** Every call that matched, even past the cap. */
  total: number;
  truncated: boolean;
};
export const TRUST_NOTE = "Trust describes the evidence, not investment quality.";
export const TRUST_BASIS =
  "Extracted (L0) passed structural checks only; Text-checked (L1) passed evidence and deterministic checks and the text critic; Audio-agreed (L2) caption and audio agree on the cited evidence; Human-verified (L3) a named reviewer listened to the cited span and signed it.";
const TRUST_NAMES: Record<string, string> = {
  L0: "Extracted",
  L1: "Text-checked",
  L2: "Audio-agreed",
  L3: "Human-verified",
};

/** One CSV field: quoted when needed, formula-leading text neutralised. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function sessionDate(row: CallRow) {
  const at = row.publishedAt ?? row.createdAt;
  if (!at) return null;
  try {
    return sessionFor(at).session;
  } catch {
    return null;
  }
}
function videoLink(videoId: string, seconds: number | null | undefined) {
  const base = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  return seconds === null || seconds === undefined ? base : `${base}&t=${Math.max(0, Math.floor(seconds))}s`;
}
function parsedText(parsed: ParsedLevel | null) {
  if (!parsed) return "";
  const unit = parsed.unit === "percent" ? "%" : "";
  if (parsed.shape === "range") return `${parsed.low}${unit}–${parsed.high}${unit}`;
  return parsed.values.map((v) => `${v}${unit}`).join(", ");
}
const joined = (values: string[]) => values.join("; ");

/** The values of one call, by column. */
function cells(row: CallRow): Record<ExportColumn, string | null> {
  const first = row.evidence[0];
  return {
    call_id: row.id,
    session_date: sessionDate(row),
    published_at_utc: row.publishedAt ?? row.createdAt,
    channel_id: row.channelId,
    channel: row.channelTitle,
    video_title: row.videoTitle,
    video_link: videoLink(row.videoId, first?.startSeconds),
    instrument: row.instrumentKey,
    instrument_type: row.kind,
    ticker: row.ticker,
    instrument_spoken: row.instrument,
    stance: row.stance,
    sentiment: row.sentiment,
    conviction: row.conviction,
    trust_level: row.trustLevel,
    trust: TRUST_NAMES[row.trustLevel] ?? row.trustLevel,
    thesis: row.thesis,
    action: row.action,
    levels_original: joined(row.levels.map((l) => `${l.kind}: ${l.valueOriginal}`)),
    levels_parsed: joined(row.levels.map((l) => `${l.kind}: ${parsedText(l.parsed)}`)),
    catalysts: joined(row.catalysts),
    risks: joined(row.risks),
    conditions: joined(row.conditions),
    horizon: row.horizon,
    expiry_date: row.expiryDate,
    expiry_original: row.expiryOriginal,
    quote_original: row.evidence.map((e) => e.textOriginal).join(" | "),
    quote_translation: row.evidence.map((e) => e.translationEn ?? "").join(" | "),
  };
}
function countLine(meta: ExportMeta, rows: number) {
  const noun = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "call" : "calls"}`;
  return meta.truncated
    ? `This file holds the first ${rows.toLocaleString("en-US")} of ${meta.total.toLocaleString("en-US")} matching calls (the export limit is ${EXPORT_CAP.toLocaleString("en-US")}); narrow the filters for the rest.`
    : `${noun(rows)} · exported ${meta.exportedAt}`;
}
export function toCsv(rows: CallRow[], meta: ExportMeta): string {
  const lines = [EXPORT_COLUMNS.map((c) => c.id).join(",")];
  for (const row of rows) {
    const values = cells(row);
    lines.push(EXPORT_COLUMNS.map((c) => csvCell(values[c.id])).join(","));
  }
  // Each footer line is written as-is after "# ", so a reader that skips
  // comment lines (pandas `comment="#"`) drops it whole. A spreadsheet shows
  // it below the data; a comma in it only moves the rest into the next cell.
  const footer = [
    `Filters: ${meta.filters}`,
    `Trust basis: ${TRUST_BASIS}`,
    TRUST_NOTE,
    countLine(meta, rows.length),
  ].map((text) => `# ${text.replace(/[\r\n]+/g, " ")}`);
  return `﻿${[...lines, ...footer].join("\r\n")}\r\n`;
}
export function toJson(rows: CallRow[], meta: ExportMeta): string {
  return JSON.stringify(
    {
      exportedAt: meta.exportedAt,
      filters: meta.filters,
      trustBasis: TRUST_BASIS,
      note: TRUST_NOTE,
      total: meta.total,
      count: rows.length,
      truncated: meta.truncated,
      calls: rows.map((row) => ({
        id: row.id,
        sessionDate: sessionDate(row),
        publishedAtUtc: row.publishedAt ?? row.createdAt,
        channel: { id: row.channelId, title: row.channelTitle },
        video: {
          id: row.videoId,
          runId: row.runId,
          title: row.videoTitle,
          link: videoLink(row.videoId, row.evidence[0]?.startSeconds),
        },
        instrument: {
          key: row.instrumentKey,
          label: row.instrumentLabel,
          kind: row.kind,
          ticker: row.ticker,
          spoken: row.instrument,
        },
        stance: row.stance,
        sentiment: row.sentiment,
        conviction: row.conviction,
        trust: { level: row.trustLevel, name: TRUST_NAMES[row.trustLevel] ?? row.trustLevel },
        thesis: row.thesis,
        action: row.action,
        levels: row.levels.map((l) => ({ kind: l.kind, original: l.valueOriginal, parsed: l.parsed })),
        catalysts: row.catalysts,
        risks: row.risks,
        conditions: row.conditions,
        horizon: row.horizon,
        expiry: { date: row.expiryDate, original: row.expiryOriginal },
        evidence: row.evidence.map((e) => ({
          ordinal: e.ordinal,
          startSeconds: e.startSeconds,
          endSeconds: e.endSeconds,
          link: videoLink(row.videoId, e.startSeconds),
          original: e.textOriginal,
          translation: e.translationEn,
        })),
      })),
    },
    null,
    2,
  );
}

/** The filters in plain words, for the file footer. */
export function describeFilters(input: Record<string, unknown>): string {
  const parts: string[] = [];
  const list = (v: unknown) => (Array.isArray(v) && v.length ? v.map(String).join(", ") : null);
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text) parts.push(`Text “${text}”`);
  const add = (label: string, value: string | null) => value && parts.push(`${label} ${value}`);
  add("instruments", list(input.instruments));
  add("type", list(input.kinds));
  add("sentiment", list(input.sentiments));
  add("stance", list(input.stances));
  add("conviction", list(input.convictions));
  if (typeof input.minTrust === "string" && input.minTrust !== "L0")
    parts.push(`minimum trust ${TRUST_NAMES[input.minTrust] ?? input.minTrust}`);
  add("channels", list(input.channels));
  if (typeof input.from === "string") parts.push(`published from ${input.from}`);
  if (typeof input.to === "string") parts.push(`published before ${input.to}`);
  if (input.pinnedOnly === true) parts.push("pinned only");
  if (input.hasLevels === true) parts.push("has levels");
  if (typeof input.expiresWithin === "number") parts.push(`expires within ${input.expiresWithin} days`);
  if (input.canonicalOnly === false) parts.push("every run, not only the published one");
  if (!parts.length) return "None (every canonical call)";
  const [first, ...rest] = parts;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join("; ");
}

/**
 * The query/export input: the calls filters and sort, plus the format (CSV
 * when absent, so a bare GET answers like every other read). Paging is the
 * export's own.
 */
export const ExportQuery = withFilters({
  sort: z.enum(["newest", "conviction", "trust"]).default("newest"),
  format: z.enum(["csv", "json"]).default("csv"),
});
/**
 * Every call matching the filters, newest first (or in the given sort), up to
 * `cap`. Walks the query API page by page; `truncated` says the cap was hit,
 * and `total` is the true number of matches either way.
 */
export async function exportCalls(
  input: unknown,
  options: { cap?: number; pageSize?: number; now?: Date } = {},
) {
  // Strict like query/calls: paging is the export's own, so limit and offset are refused.
  const { format, ...filters } = ExportQuery.parse(input) as z.output<typeof ExportQuery> &
    Record<string, unknown>;
  const cap = options.cap ?? EXPORT_CAP;
  const pageSize = Math.min(options.pageSize ?? MAX_PAGE, MAX_PAGE);
  const rows: CallRow[] = [];
  let total = 0;
  for (let offset = 0; rows.length < cap; ) {
    const page = await queryCallsPage({
      ...filters,
      limit: Math.min(pageSize, cap - rows.length),
      offset,
    });
    total = page.total;
    rows.push(...page.rows);
    if (page.nextOffset === null || page.rows.length === 0) break;
    offset = page.nextOffset;
  }
  const exportedAt = (options.now ?? new Date()).toISOString();
  const meta: ExportMeta = {
    filters: describeFilters(filters),
    exportedAt,
    total,
    truncated: total > rows.length,
  };
  const day = exportedAt.slice(0, 10);
  return {
    filename: `youtube-calls-${day}.${format}`,
    contentType: format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    body: format === "csv" ? toCsv(rows, meta) : toJson(rows, meta),
    rows: rows.length,
    total,
    truncated: meta.truncated,
  };
}
