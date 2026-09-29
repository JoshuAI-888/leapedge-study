import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  expiryStatus,
  formatLevel,
  parseLevel,
} from "../src/features/youtube-intelligence/level-parse.ts";
import { freshDatabase } from "./helpers/db.ts";
import {
  Claim,
  type CheckedClaim,
  type Run,
} from "../src/features/youtube-intelligence/contracts.ts";
import {
  PointerExtraction,
  extractionResponseSchema,
  extractionResponseSchemaV2,
} from "../src/server/youtube-intelligence/schemas/extraction.ts";
import {
  rowsForRun,
  writeRunRows,
} from "../src/server/youtube-intelligence/repos/publish.ts";
import {
  claimContentDigest,
  claimsForRun,
} from "../src/server/youtube-intelligence/repos/claims.ts";
import { mentionsForRun } from "../src/server/youtube-intelligence/repos/mentions.ts";

type Expected = {
  low: number;
  high: number;
  currency?: string | null;
  comparator?: string | null;
  unit?: string;
  shape?: string;
  values?: number[];
};
const CASES: [string, Expected | null][] = [
  // Plain numbers, with and without thousands separators.
  ["724.32", { low: 724.32, high: 724.32, comparator: null, unit: "price", shape: "point" }],
  ["75000", { low: 75000, high: 75000 }],
  ["75,000", { low: 75000, high: 75000 }],
  ["7,500.50", { low: 7500.5, high: 7500.5 }],
  // Ranges.
  ["83000到85400", { low: 83000, high: 85400, comparator: "between", shape: "range" }],
  ["83,000–85,400", { low: 83000, high: 85400, comparator: "between" }],
  ["75000附近至76500", { low: 75000, high: 76500, comparator: "between" }],
  ["340-322", { low: 322, high: 340, comparator: "between", values: [340, 322] }],
  ["between 50 and 60", { low: 50, high: 60, comparator: "between" }],
  ["$50-$60", { low: 50, high: 60, currency: "USD", comparator: "between" }],
  ["1.5万到2万", { low: 15000, high: 20000, comparator: "between" }],
  ["20%-30%", { low: 20, high: 30, unit: "percent", comparator: "between" }],
  ["20-30%", { low: 20, high: 30, unit: "percent" }],
  // Comparators.
  ["突破724.32以上", { low: 724.32, high: 724.32, comparator: "above" }],
  ["under $20", { low: 20, high: 20, comparator: "below", currency: "USD" }],
  ["跌破100", { low: 100, high: 100, comparator: "below" }],
  ["close above 150", { low: 150, high: 150, comparator: "above" }],
  ["200以下", { low: 200, high: 200, comparator: "below" }],
  ["4500左右", { low: 4500, high: 4500, comparator: "near" }],
  ["around 4,500", { low: 4500, high: 4500, comparator: "near" }],
  // Two targets are a list, not a range.
  ["$50, $100", { low: 50, high: 100, shape: "list", values: [50, 100], currency: "USD", comparator: null }],
  ["50、60、70", { low: 50, high: 70, shape: "list", values: [50, 60, 70] }],
  // Currencies and round-number language.
  ["300美元整数关口", { low: 300, high: 300, currency: "USD", comparator: null }],
  ["HK$350", { low: 350, high: 350, currency: "HKD" }],
  ["350港元", { low: 350, high: 350, currency: "HKD" }],
  ["人民币50", { low: 50, high: 50, currency: "CNY" }],
  // Multipliers: k and 万 (10,000), 亿 (100,000,000).
  ["75k", { low: 75000, high: 75000 }],
  ["$1.2K", { low: 1200, high: 1200, currency: "USD" }],
  ["7.5万", { low: 75000, high: 75000 }],
  ["10万美元", { low: 100000, high: 100000, currency: "USD" }],
  ["2亿", { low: 200000000, high: 200000000 }],
  // Percentages and index points.
  ["10%", { low: 10, high: 10, unit: "percent" }],
  ["上涨20%", { low: 20, high: 20, unit: "percent" }],
  ["-15%", { low: -15, high: -15, unit: "percent" }],
  ["5000点", { low: 5000, high: 5000, unit: "points" }],
  // Not levels: dates, periods, ratios, words.
  ["2028财年结束前", null],
  ["2026年底", null],
  ["Q3", null],
  ["3 to 5 years", null],
  ["next week", null],
  ["1:2", null],
  ["", null],
  ["N/A", null],
  // Ambiguous: never guess.
  ["50/100", null],
  ["1,23", null],
  ["7.5-8万", null],
  ["entry 50 target 60", null],
  ["above 50 below 60", null],
  ["$50 or ¥60", null],
];

for (const [input, expected] of CASES)
  test(`parseLevel(${JSON.stringify(input)})`, () => {
    const parsed = parseLevel(input);
    if (expected === null) {
      assert.equal(parsed, null);
      return;
    }
    assert.ok(parsed, `${input} did not parse`);
    assert.equal(parsed!.low, expected.low);
    assert.equal(parsed!.high, expected.high);
    for (const key of ["currency", "comparator", "unit", "shape"] as const)
      if (expected[key] !== undefined)
        assert.equal(parsed![key], expected[key], `${input}: ${key}`);
    if (expected.values) assert.deepEqual(parsed!.values, expected.values);
  });

test("parseLevel keeps defaults for a bare number", () => {
  assert.deepEqual(parseLevel("724.32"), {
    low: 724.32,
    high: 724.32,
    values: [724.32],
    shape: "point",
    currency: null,
    comparator: null,
    unit: "price",
  });
});

test("parseLevel tolerates non-string and oversized input without throwing", () => {
  assert.equal(parseLevel(null as unknown as string), null);
  assert.equal(parseLevel(undefined as unknown as string), null);
  assert.equal(parseLevel("9".repeat(400)), null);
});

test("expiryStatus counts calendar days and turns soon, then expired", () => {
  assert.deepEqual(expiryStatus("2026-10-31", "2026-09-29"), { days: 32, state: "open" });
  assert.deepEqual(expiryStatus("2026-10-06", "2026-09-29"), { days: 7, state: "soon" });
  assert.deepEqual(expiryStatus("2026-09-29", "2026-09-29"), { days: 0, state: "soon" });
  assert.deepEqual(expiryStatus("2026-09-28", "2026-09-29"), { days: -1, state: "expired" });
  assert.equal(expiryStatus(null, "2026-09-29"), null);
  assert.equal(expiryStatus("2026-02-30", "2026-09-29"), null);
  assert.equal(expiryStatus("end of October", "2026-09-29"), null);
});

test("formatLevel writes the parse back in plain words", () => {
  assert.equal(formatLevel(parseLevel("突破724.32以上")!), "above 724.32");
  assert.equal(formatLevel(parseLevel("83000到85400")!), "83,000–85,400");
  assert.equal(formatLevel(parseLevel("$50, $100")!), "$50 · $100");
  assert.equal(formatLevel(parseLevel("under $20")!), "below $20");
  assert.equal(formatLevel(parseLevel("4500左右")!), "near 4,500");
  assert.equal(formatLevel(parseLevel("20-30%")!), "20%–30%");
  assert.equal(formatLevel(parseLevel("HK$350")!), "HK$350");
  assert.equal(formatLevel(parseLevel("5000点")!), "5,000 pts");
});

// --- call fields v2: contract, extraction boundary and storage ---------------

const oldClaim = {
  thesis_en: "Buy the dip on strong earnings.",
  instrument_as_spoken: "Bitcoin",
  ticker: "BTC",
  ticker_explicit: true,
  stance: "long",
  horizon_en: "Swing",
  conditions_en: ["If 75,000 support holds"],
  creator_conviction: "high",
  risks_en: ["ETF outflows"],
  levels: [
    { kind: "entry", value_original: "75000附近至76500" },
    { kind: "target", value_original: "83000到85400" },
    { kind: "target", value_original: "2028财年结束前" },
  ],
  evidence: [
    {
      segment_id: "s1",
      quote_original: "75000附近至76500买入，目标83000到85400",
      quote_translation_en:
        "Buy around 75,000 to 76,500, target 83,000 to 85,400",
    },
  ],
};

test("Claims without the new fields still parse, and new fields are kept when present", () => {
  const old = Claim.parse(oldClaim);
  assert.equal(old.catalysts_en, undefined);
  assert.equal(old.action_en, undefined);
  const rich = Claim.parse({
    ...oldClaim,
    catalysts_en: ["ETF inflows", "Fed pause"],
    action_en: "Buy near the 75,000-76,500 support",
    expiry: { date: "2026-10-31", original: "end of October" },
    macro_theme: null,
  });
  assert.deepEqual(rich.catalysts_en, ["ETF inflows", "Fed pause"]);
  assert.equal(rich.action_en, "Buy near the 75,000-76,500 support");
  assert.deepEqual(rich.expiry, {
    date: "2026-10-31",
    original: "end of October",
  });
});

test("A malformed expiry date from the model becomes null instead of failing the extraction", () => {
  const { evidence: _evidence, ...fields } = oldClaim;
  const parsed = PointerExtraction.parse({
    claims: [
      {
        ...fields,
        evidence_ranges: [{ start_id: "s1", end_id: "s1" }],
        expiry: { date: "31/10/2026", original: "31 October" },
        catalysts_en: [],
        action_en: null,
        macro_theme: "Rates",
      },
    ],
    key_points: [],
    mentions: [],
  });
  assert.deepEqual(parsed.claims[0].expiry, {
    date: null,
    original: "31 October",
  });
  assert.equal(parsed.claims[0].macro_theme, "Rates");
});

test("The v2 response schema adds the call fields as optional and leaves v1 untouched", () => {
  type Items = {
    items: { properties: Record<string, unknown>; required: string[] };
  };
  const v1 = (extractionResponseSchema.properties.claims as Items).items;
  const v2 = (extractionResponseSchemaV2.properties.claims as Items).items;
  for (const key of ["catalysts_en", "action_en", "expiry", "macro_theme"]) {
    assert.ok(v2.properties[key], `${key} missing from v2`);
    assert.ok(!v2.required.includes(key), `${key} must be optional`);
    assert.equal(v1.properties[key], undefined);
  }
  assert.deepEqual(
    (v2.properties.macro_theme as { enum: string[] }).enum.slice(0, 8),
    ["Rates", "Inflation", "USD", "Oil", "Gold", "Growth", "Liquidity", "Credit"],
  );
});

function fixtureRun(claim: Record<string, unknown>): Run {
  const text = oldClaim.evidence[0].quote_original;
  const checked: CheckedClaim = {
    id: "c1",
    claim: Claim.parse(claim),
    passed: true,
    reasons: [],
    audit: { verdict: "accept", reason_en: "Supported." },
  };
  return {
    id: "run-call-fields",
    videoId: "aB1cD2eF3gH",
    url: "https://www.youtube.com/watch?v=aB1cD2eF3gH",
    model: "fake",
    promptVersion: "evidence-first.web.v9",
    title: "Fixture",
    status: "completed",
    stage: "done",
    createdAt: "2026-09-28T12:00:00.000Z",
    updatedAt: "2026-09-28T12:00:00.000Z",
    error: null,
    input: {},
    output: {
      metadata: {
        channelId: "UCfixture00000000000001",
        publishedAt: "2026-09-28T12:00:00.000Z",
      },
      source: {
        source_kind: "imported_transcript",
        language: "zh",
        segments: [{ id: "s1", text, start_seconds: 0, end_seconds: 5 }],
      },
      claims: [checked],
      mentions: [
        {
          ticker: null,
          instrument_as_spoken: "美联储",
          market: "unknown",
          stance: "watch",
          sentiment: "neutral",
          rationale_en: "The creator watches the Fed.",
          source_span: {
            start_id: "s1",
            end_id: "s1",
            start_seconds: 0,
            end_seconds: 5,
            text_hash: createHash("sha256").update(text).digest("hex"),
          },
          is_call: false,
          claim_id: null,
        },
      ],
    },
    cost: 0,
  };
}

test("Publishing stores parsed levels, catalysts, action, expiry and theme on the claim row", async () => {
  await freshDatabase();
  const run = fixtureRun({
    ...oldClaim,
    catalysts_en: ["ETF inflows", "Fed pause"],
    action_en: "Buy near the 75,000-76,500 support",
    expiry: { date: "2026-10-31", original: "end of October" },
    macro_theme: "rates",
  });
  await writeRunRows(rowsForRun(run));
  const [row] = await claimsForRun(run.id);
  assert.deepEqual(row.catalystsEn, ["ETF inflows", "Fed pause"]);
  assert.equal(row.actionEn, "Buy near the 75,000-76,500 support");
  assert.equal(row.expiryDate, "2026-10-31");
  assert.equal(row.expiryOriginal, "end of October");
  // The model's theme is normalised to the vocabulary before it is stored.
  assert.equal(row.macroTheme, "Rates");
  assert.equal(row.levels!.length, 3);
  assert.deepEqual(row.levels![0], {
    kind: "entry",
    valueOriginal: "75000附近至76500",
    parsed: parseLevel("75000附近至76500"),
  });
  // Unparseable wording is kept verbatim with no number.
  assert.deepEqual(row.levels![2], {
    kind: "target",
    valueOriginal: "2028财年结束前",
    parsed: null,
  });
  const [mention] = await mentionsForRun(run.id);
  assert.equal(mention.instrument, "美联储");
});

test("An older claim publishes with empty call fields, and they never enter the review digest", async () => {
  await freshDatabase();
  const run = fixtureRun({ ...oldClaim, levels: [] });
  await writeRunRows(rowsForRun(run));
  const [row] = await claimsForRun(run.id);
  assert.deepEqual(row.levels, []);
  assert.deepEqual(row.catalystsEn, []);
  assert.equal(row.actionEn, null);
  assert.equal(row.expiryDate, null);
  assert.equal(row.expiryOriginal, null);
  assert.equal(row.macroTheme, null);
  // Signed reviews bind the digest; adding call fields must not revoke them.
  const bare = {
    ...row,
    levels: undefined,
    catalystsEn: undefined,
    actionEn: undefined,
    expiryDate: undefined,
    expiryOriginal: undefined,
    macroTheme: undefined,
  };
  assert.equal(claimContentDigest(row, []), claimContentDigest(bare, []));
});
