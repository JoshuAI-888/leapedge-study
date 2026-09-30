import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/db.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import {
  csvCell,
  describeFilters,
  exportCalls,
  toCsv,
  toJson,
  type ExportMeta,
} from "../src/server/youtube-intelligence/export.ts";
import type { CallRow } from "../src/server/youtube-intelligence/repos/research-query.ts";
import { EXPORT_COLUMNS } from "../src/features/youtube-intelligence/export-columns.ts";
import { dispatch } from "../src/server/youtube-intelligence/actions/index.ts";

/**
 * F63. Call exports: RFC 4180 CSV with formula-injection protection and a
 * "#" footer, JSON with nested evidence spans, and a server action that pages
 * through every matching call up to a hard cap and says when it cut the file.
 */
const row = (patch: Partial<CallRow> = {}): CallRow => ({
  id: "run1:c1",
  runId: "run1",
  videoId: "dQw4w9WgXcQ",
  videoTitle: "NVIDIA, \"capex\" and you",
  channelId: "UCa",
  channelTitle: "Alpha Markets",
  instrument: "NVIDIA",
  ticker: "NVDA",
  instrumentKey: "NVDA",
  instrumentLabel: "NVDA",
  kind: "stock",
  stance: "long",
  sentiment: "bullish",
  conviction: "high",
  trustLevel: "L1",
  thesis: "Data centre demand keeps accelerating",
  horizon: "12 months",
  conditions: ["Capex holds"],
  risks: ["Export limits", "Valuation"],
  publishedAt: "2026-09-26T18:00:00.000Z",
  createdAt: "2026-09-26T19:00:00.000Z",
  action: "plan_buy",
  levels: [
    { kind: "target", valueOriginal: "$200", parsed: { low: 200, high: 200, values: [200], shape: "point", currency: "USD", comparator: null, unit: "price" } },
    { kind: "entry", valueOriginal: "around the 50-day", parsed: null },
    { kind: "support", valueOriginal: "120-125", parsed: { low: 120, high: 125, values: [120, 125], shape: "range", currency: null, comparator: "between", unit: "price" } },
  ],
  catalysts: [{ text: "Earnings", date: "18 November" }],
  expiryDate: "2026-12-31",
  expiryOriginal: "by year end",
  macroTheme: null,
  evidence: [
    { ordinal: 0, startSeconds: 12.7, endSeconds: 18, textOriginal: "需求在加速", translationEn: "Demand is accelerating" },
    { ordinal: 1, startSeconds: 40, endSeconds: 44, textOriginal: "Buy the dip", translationEn: null },
  ],
  ...patch,
});
const meta: ExportMeta = {
  filters: "Instruments NVDA; minimum trust Text-checked",
  exportedAt: "2026-09-29T08:00:00.000Z",
  total: 1,
  truncated: false,
};
/** A small RFC 4180 reader, so the tests check what a spreadsheet would see. */
function parseCsv(text: string) {
  const records: string[][] = [];
  let field = "",
    record: string[] = [],
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") record.push(field), (field = "");
    else if (c === "\r" && text[i + 1] === "\n") {
      record.push(field), records.push(record), (record = []), (field = ""), i++;
    } else field += c;
  }
  if (field || record.length) record.push(field), records.push(record);
  return records;
}

test("CSV cells follow RFC 4180: commas, quotes and line breaks are quoted", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(12.5), "12.5");
});

test("Cells that a spreadsheet would run as a formula are neutralised", () => {
  for (const danger of ["=HYPERLINK(\"x\")", "+1+1", "-2+3", "@SUM(A1)", "\tTAB", "\rCR"])
    assert.equal(parseCsv(csvCell(danger))[0][0], `'${danger}`, JSON.stringify(danger));
  assert.equal(csvCell("NVDA = cheap"), "NVDA = cheap", "only a leading character counts");
  const csv = toCsv([row({ thesis: "=cmd|' /C calc'!A0" })], meta);
  const thesis = parseCsv(csv.replace(/^﻿/, ""))[1][EXPORT_COLUMNS.findIndex((c) => c.id === "thesis")];
  assert.equal(thesis, "'=cmd|' /C calc'!A0");
});

test("A CSV has a header of the fixed columns, one record per call and a # footer", () => {
  const csv = toCsv([row()], meta);
  assert.ok(csv.startsWith("﻿"), "a BOM so spreadsheet apps read UTF-8");
  assert.ok(csv.includes("\r\n"), "CRLF line endings");
  const records = parseCsv(csv.slice(1));
  assert.deepEqual(records[0], EXPORT_COLUMNS.map((c) => c.id));
  const get = (id: string) => records[1][EXPORT_COLUMNS.findIndex((c) => c.id === id)];
  assert.equal(get("call_id"), "run1:c1");
  assert.equal(get("session_date"), "2026-09-28", "a Saturday upload belongs to Monday's session");
  assert.equal(get("published_at_utc"), "2026-09-26T18:00:00.000Z");
  assert.equal(get("video_title"), 'NVIDIA, "capex" and you');
  assert.equal(get("video_link"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s");
  assert.equal(get("instrument_type"), "stock");
  assert.equal(get("trust"), "Text-checked");
  assert.equal(get("levels_original"), "target: $200; entry: around the 50-day; support: 120-125");
  assert.equal(get("levels_parsed"), "target: 200; entry: ; support: 120–125");
  assert.equal(get("risks"), "Export limits; Valuation");
  assert.equal(get("expiry_date"), "2026-12-31");
  assert.equal(get("quote_original"), "需求在加速 | Buy the dip");
  assert.equal(get("quote_translation"), "Demand is accelerating | ");
  const footer = csv.trimEnd().split("\r\n").slice(-4);
  assert.ok(footer.every((line) => line.startsWith("#")), "footer lines start with #");
  assert.match(footer.join("\n"), /Filters: Instruments NVDA; minimum trust Text-checked/);
  assert.match(footer.join("\n"), /Trust basis/);
  assert.match(footer.join("\n"), /Trust describes the evidence, not investment quality/);
  assert.match(footer.join("\n"), /1 call/);
});

test("CJK text survives unchanged", () => {
  const csv = toCsv([row({ videoTitle: "美联储降息与黄金走势｜陈博士", channelTitle: "陈博士财经" })], meta);
  const records = parseCsv(csv.slice(1));
  const get = (id: string) => records[1][EXPORT_COLUMNS.findIndex((c) => c.id === id)];
  assert.equal(get("video_title"), "美联储降息与黄金走势｜陈博士");
  assert.equal(get("channel"), "陈博士财经");
  const json = JSON.parse(toJson([row({ channelTitle: "陈博士财经" })], meta));
  assert.equal(json.calls[0].channel.title, "陈博士财经");
});

test("An empty set still has its header and footer", () => {
  const csv = toCsv([], { ...meta, total: 0 });
  const lines = csv.slice(1).trimEnd().split("\r\n");
  assert.equal(lines[0], EXPORT_COLUMNS.map((c) => c.id).join(","));
  assert.ok(lines.slice(1).every((l) => l.startsWith("#")));
  assert.match(csv, /0 calls/);
  const json = JSON.parse(toJson([], { ...meta, total: 0 }));
  assert.deepEqual(json.calls, []);
  assert.equal(json.count, 0);
});

test("A cut file says so in its footer", () => {
  const csv = toCsv([row()], { ...meta, total: 25000, truncated: true });
  assert.match(csv, /# .*first 1 of 25,000 matching calls/);
  const json = JSON.parse(toJson([row()], { ...meta, total: 25000, truncated: true }));
  assert.deepEqual([json.truncated, json.total, json.count], [true, 25000, 1]);
});

test("JSON nests evidence spans and levels, and carries the same footer facts", () => {
  const json = JSON.parse(toJson([row()], meta));
  assert.equal(json.note, "Trust describes the evidence, not investment quality.");
  assert.equal(json.filters, meta.filters);
  assert.match(json.trustBasis, /Text-checked/);
  const call = json.calls[0];
  assert.deepEqual(call.evidence, [
    {
      ordinal: 0,
      startSeconds: 12.7,
      endSeconds: 18,
      link: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s",
      original: "需求在加速",
      translation: "Demand is accelerating",
    },
    {
      ordinal: 1,
      startSeconds: 40,
      endSeconds: 44,
      link: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=40s",
      original: "Buy the dip",
      translation: null,
    },
  ]);
  assert.deepEqual(call.levels[1], { kind: "entry", original: "around the 50-day", parsed: null });
  assert.equal(call.levels[2].parsed.high, 125);
  assert.deepEqual(call.instrument, { key: "NVDA", label: "NVDA", kind: "stock", ticker: "NVDA", spoken: "NVIDIA" });
  assert.deepEqual(call.trust, { level: "L1", name: "Text-checked" });
  assert.deepEqual(call.expiry, { date: "2026-12-31", original: "by year end" });
  assert.equal(call.sessionDate, "2026-09-28");
});

test("The filter line names every filter in plain words", () => {
  assert.equal(describeFilters({}), "None (every canonical call)");
  assert.equal(
    describeFilters({
      text: "capex",
      instruments: ["NVDA", "Rates"],
      kinds: ["macro"],
      sentiments: ["bullish"],
      stances: ["long"],
      convictions: ["high"],
      minTrust: "L2",
      channels: ["UCa"],
      from: "2026-09-18T20:00:00.000Z",
      pinnedOnly: true,
      hasLevels: true,
      expiresWithin: 30,
    }),
    "Text “capex”; instruments NVDA, Rates; type macro; sentiment bullish; stance long; conviction high; minimum trust Audio-agreed; channels UCa; published from 2026-09-18T20:00:00.000Z; pinned only; has levels; expires within 30 days",
  );
});

test("The export action pages through every match and stops at the cap", async () => {
  await freshDatabase();
  for (let i = 0; i < 7; i++)
    await database
      .prepare(
        "INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,input,output) VALUES($1,$2,$3,'m','v1',$4,'completed','publish',$5,$5,'{}','{}')",
      )
      .run(`run${i}`, `vid0000000${i}`, `https://www.youtube.com/watch?v=vid0000000${i}`, `Video ${i}, part “${i}”`, `2026-09-0${i + 1}T12:00:00.000Z`);
  for (let i = 0; i < 7; i++)
    await database
      .prepare(
        "INSERT INTO claims(id,run_id,video_id,channel_id,instrument,ticker,stance,thesis_en,creator_conviction,trust_level,published_at,created_at) VALUES($1,$2,$3,'UCa','NVIDIA','NVDA','long',$4,'high','L1',$5,$5)",
      )
      .run(`run${i}:c1`, `run${i}`, `vid0000000${i}`, `Thesis ${i}`, `2026-09-0${i + 1}T12:00:00.000Z`);
  const all = await exportCalls({ format: "csv", minTrust: "L1" }, { pageSize: 3 });
  assert.equal(all.contentType, "text/csv; charset=utf-8");
  assert.match(all.filename, /^youtube-calls-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.deepEqual([all.rows, all.total, all.truncated], [7, 7, false]);
  assert.equal(parseCsv(all.body.slice(1)).filter((r) => r[0].startsWith("run")).length, 7);
  const cut = await exportCalls({ format: "json", instruments: ["NVDA"] }, { pageSize: 3, cap: 5 });
  const json = JSON.parse(cut.body);
  assert.deepEqual([cut.rows, cut.total, cut.truncated, json.calls.length], [5, 7, true, 5]);
  assert.equal(cut.contentType, "application/json; charset=utf-8");
  assert.equal(json.calls[0].id, "run6:c1", "newest first");
  const none = await exportCalls({ format: "csv", text: "nothing like this" });
  assert.deepEqual([none.rows, none.total, none.truncated], [0, 0, false]);
  // Through the action table, as the Export menu calls it (a read, so GET).
  const viaAction = (await dispatch("query", "export", { format: "csv", limit: 5 }).catch((e: Error) => e)) as Error;
  assert.ok(viaAction instanceof Error, "paging fields are not export input");
  const ok = (await dispatch("query", "export", { format: "json" })) as { rows: number };
  assert.equal(ok.rows, 7);
  // A bare read (no input) is a CSV of every call, like any other query read.
  const bare = (await dispatch("query", "export", undefined)) as { contentType: string; rows: number };
  assert.deepEqual([bare.contentType, bare.rows], ["text/csv; charset=utf-8", 7]);
});

test("The Export menu states its scope and the export cap", async () => {
  const { exportScope } = await import("../src/features/youtube-intelligence/export-columns.ts");
  assert.equal(exportScope(41), "41 calls matching these filters");
  assert.equal(exportScope(1), "1 call matching these filters");
  assert.equal(exportScope(0), "0 calls matching these filters");
  assert.equal(exportScope(3, false), "3 calls");
  assert.equal(exportScope(25000), "The first 20,000 of 25,000 calls matching these filters");
});
