import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_IDEAS_TEXT,
  keyPointItems,
  keyPointsOf,
  overallConviction,
  summaryOf,
  verdictLineText,
  verdictOf,
  sourceLanguageLabel,
  briefCostEstimate,
} from "../src/features/youtube-intelligence/verdict.ts";
import type { CheckedClaim } from "../src/features/youtube-intelligence/contracts.ts";

const call = (
  over: Partial<{
    id: string;
    stance: string;
    creatorConviction: string;
    ticker: string | null;
    instrument: string | null;
    macroTheme: string | null;
  }> = {},
) => ({
  id: over.id ?? "r:c1",
  stance: over.stance ?? "long",
  creatorConviction: over.creatorConviction ?? "medium",
  ticker: over.ticker === undefined ? "NVDA" : over.ticker,
  instrument: over.instrument ?? null,
  macroTheme: over.macroTheme ?? null,
});

const checked = (
  id: string,
  thesis: string,
  start: number | null,
  passed = true,
  reasons: string[] = [],
): CheckedClaim => ({
  id,
  passed,
  reasons,
  claim: {
    thesis_en: thesis,
    instrument_as_spoken: null,
    ticker: null,
    ticker_explicit: false,
    stance: "neutral",
    horizon_en: null,
    conditions_en: [],
    creator_conviction: "unspecified",
    risks_en: [],
    levels: [],
    evidence: [
      {
        segment_id: "s1",
        quote_original: "quote",
        quote_translation_en: "quote",
        source_span:
          start === null
            ? undefined
            : {
                start_id: "s1",
                end_id: "s1",
                start_seconds: start,
                end_seconds: start + 5,
                text_hash: "a".repeat(64),
              },
      },
    ],
  },
});

test("verdictOf counts ideas, sentiment and distinct instruments in call order", () => {
  const v = verdictOf([
    call({ id: "r:1", ticker: "NVDA", stance: "long" }),
    call({ id: "r:2", ticker: "AVGO", stance: "long" }),
    call({ id: "r:3", ticker: "NVDA", stance: "long" }),
    call({ id: "r:4", ticker: "TSM", stance: "watch" }),
  ]);
  assert.equal(v.ideas, 4);
  assert.deepEqual(v.split, { bullish: 3, neutral: 1, bearish: 0 });
  assert.deepEqual(
    v.instruments.map((i) => i.text),
    ["NVDA", "AVGO", "TSM"],
  );
  assert.equal(verdictLineText(v), "4 ideas · 3 ▲ 1 ● · NVDA AVGO TSM");
});

test("the verdict line is singular for one idea and never shows zero sentiments", () => {
  const v = verdictOf([call({ stance: "short", ticker: "AAPL" })]);
  assert.equal(verdictLineText(v), "1 idea · 1 ▼ · AAPL");
});

test("instruments use the instrument label text, including themes", () => {
  const v = verdictOf([
    call({ id: "r:1", ticker: null, instrument: "interest rates", macroTheme: "rates" }),
    call({ id: "r:2", ticker: "NVDA" }),
  ]);
  assert.equal(v.instruments.length, 2);
  assert.equal(v.instruments[1].text, "NVDA");
  assert.match(v.instruments[0].text, /MACRO/);
});

test("overall conviction is the most common stated conviction; ties go to the higher one", () => {
  assert.equal(
    overallConviction([
      call({ creatorConviction: "high" }),
      call({ creatorConviction: "medium" }),
      call({ creatorConviction: "medium" }),
    ]),
    "medium",
  );
  assert.equal(
    overallConviction([
      call({ creatorConviction: "low" }),
      call({ creatorConviction: "high" }),
    ]),
    "high",
  );
  // Unspecified never outvotes a stated conviction.
  assert.equal(
    overallConviction([
      call({ creatorConviction: "unspecified" }),
      call({ creatorConviction: "unspecified" }),
      call({ creatorConviction: "low" }),
    ]),
    "low",
  );
  assert.equal(
    overallConviction([call({ creatorConviction: "unspecified" })]),
    "unspecified",
  );
  assert.equal(overallConviction([]), null);
  // An unknown value is treated as unspecified rather than trusted.
  assert.equal(
    overallConviction([call({ creatorConviction: "extreme" })]),
    "unspecified",
  );
});

test("no accepted calls reads as a clear result, not an empty page", () => {
  const v = verdictOf([]);
  assert.equal(v.ideas, 0);
  assert.equal(v.conviction, null);
  assert.deepEqual(v.instruments, []);
  assert.equal(verdictLineText(v), NO_IDEAS_TEXT);
  assert.equal(NO_IDEAS_TEXT, "No investable ideas · educational or commentary");
});

test("key points are ordered by earliest evidence time, untimed last, capped at ten", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    text: `Point ${i}`,
    seconds: i === 0 ? null : 500 - i * 10,
    kind: "context" as const,
  }));
  const points = keyPointsOf(items);
  assert.equal(points.length, 10);
  assert.equal(points[0].text, "Point 11");
  assert.deepEqual(
    points.map((p) => p.seconds),
    [390, 400, 410, 420, 430, 440, 450, 460, 470, 480],
  );
  // With room, the untimed point comes last.
  const few = keyPointsOf(items.slice(0, 3));
  assert.deepEqual(
    few.map((p) => p.id),
    ["p2", "p1", "p0"],
  );
});

test("key points drop repeated wording and keep the earlier moment", () => {
  const points = keyPointsOf([
    { id: "a", text: "Capex was raised", seconds: 90, kind: "context" },
    { id: "b", text: "capex was raised ", seconds: 30, kind: "call" },
    { id: "c", text: "Apple lags", seconds: 60, kind: "call" },
  ]);
  assert.deepEqual(
    points.map((p) => [p.id, p.seconds]),
    [
      ["b", 30],
      ["c", 60],
    ],
  );
});

test("key point items come from passed context points and accepted calls only", () => {
  const items = keyPointItems({
    runId: "r",
    keyPoints: [
      checked("k1", "Hyperscaler capex was raised", 48),
      checked("k2", "Rejected context", 10, false),
      checked("k3", "Context with a failed check", 12, true, ["no quote"]),
    ],
    checkedClaims: [
      checked("c1", "Nvidia is a hold-and-add on pullbacks", 90),
      checked("c2", "Unpublished call", 5),
    ],
    acceptedClaimIds: ["r:c1"],
    spans: [{ claimId: "r:c1", startSeconds: 88 }],
  });
  const points = keyPointsOf(items);
  assert.deepEqual(
    points.map((p) => [p.text, p.seconds, p.kind]),
    [
      ["Hyperscaler capex was raised", 48, "context"],
      ["Nvidia is a hold-and-add on pullbacks", 88, "call"],
    ],
  );
  assert.deepEqual(keyPointsOf([]), []);
  assert.deepEqual(
    keyPointItems({
      runId: "r",
      keyPoints: undefined,
      checkedClaims: undefined,
      acceptedClaimIds: [],
      spans: [],
    }),
    [],
  );
});

test("the summary is the newest brief's lead sentence, else the extraction summary, else nothing", () => {
  const brief = (createdAt: string, texts: string[]) => ({
    createdAt,
    sentences: texts.map((text) => ({ text })),
  });
  assert.deepEqual(
    summaryOf({
      briefs: [
        brief("2026-09-27T10:00:00Z", ["Old lead."]),
        brief("2026-09-28T10:00:00Z", ["New lead.", "Second."]),
      ],
      extractionSummary: "Extraction summary.",
    }),
    { text: "New lead.", source: "brief" },
  );
  assert.deepEqual(
    summaryOf({ briefs: [brief("2026-09-28T10:00:00Z", [])], extractionSummary: " Said. " }),
    { text: "Said.", source: "extraction" },
  );
  assert.equal(summaryOf({ briefs: [], extractionSummary: undefined }), null);
  assert.equal(summaryOf({ briefs: [], extractionSummary: 42 }), null);
});

test("the source language reads as a plain translation note", () => {
  assert.equal(sourceLanguageLabel("zh-Hans"), "Chinese → English");
  assert.equal(sourceLanguageLabel("en-US"), "English");
  assert.equal(sourceLanguageLabel("asr-en"), "English");
  assert.equal(sourceLanguageLabel(undefined), null);
  assert.equal(sourceLanguageLabel("not a language!"), null);
});

test("the brief cost estimate averages recorded model and search costs, or states none", () => {
  const estimate = briefCostEstimate([
    { modelCostUsd: 0.1, externalCostUsd: 0.02 },
    { modelCostUsd: 0.2, externalCostUsd: 0.04 },
    { modelCostUsd: "n/a", externalCostUsd: 0 },
  ]);
  assert.equal(estimate?.samples, 2);
  assert.ok(Math.abs((estimate?.averageUsd ?? 0) - 0.18) < 1e-9);
  assert.equal(briefCostEstimate([]), null);
});

test("the transcript source reads as plain words, never a stored key", async () => {
  const { sourceKindText } = await import(
    "../src/features/youtube-intelligence/verdict.ts"
  );
  assert.equal(sourceKindText("native_captions_transcriptapi"), "YouTube captions");
  assert.equal(sourceKindText("google_windowed_asr"), "Audio transcription");
  assert.equal(sourceKindText("model_generated_transcript"), "Audio transcription");
  assert.equal(sourceKindText("imported_transcript"), "Imported transcript");
  assert.equal(sourceKindText("fixture_transcript"), "Fixture transcript");
  assert.equal(sourceKindText(undefined), "See evidence details");
  assert.equal(sourceKindText("something_new"), "Transcript");
});
