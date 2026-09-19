import { test } from "node:test";
import assert from "node:assert/strict";
import { Source } from "../src/features/youtube-intelligence/contracts.ts";
import { extractionChunks } from "../src/features/youtube-intelligence/chunking.ts";
import { recoverEvidenceRanges } from "../src/features/youtube-intelligence/evidence-selection.ts";
import { costUsd } from "../src/server/youtube-intelligence/transport/prices.ts";
const source = Source.parse({
  source_kind: "native_captions",
  segment_separator: " ",
  segments: Array.from({ length: 700 }, (_, i) => ({
    id: `s${i}`,
    text: `Original sentence ${i}.`,
    start_seconds: i * 5,
    end_seconds: i * 5 + 5,
  })),
});
test("An hour of speech is extracted in bounded chronological batches with every source segment retained", () => {
  const chunks = extractionChunks(source, 700000);
  assert.ok(chunks.length >= 6);
  assert.deepEqual(
    new Set(chunks.flat().map((s) => s.id)),
    new Set(source.segments.map((s) => s.id)),
  );
  for (const c of chunks)
    assert.ok(c.at(-1)!.end_seconds! - c[0].start_seconds! <= 600);
});
test("Overlong evidence splits into bounded exact copies without dropping conditions", () => {
  const c = recoverEvidenceRanges(
    {
      thesis_en: "Conditional position",
      instrument_as_spoken: null,
      ticker: null,
      ticker_explicit: false,
      stance: "conditional",
      horizon_en: null,
      conditions_en: ["Keep original conditions"],
      risks_en: [],
      creator_conviction: "unspecified",
      levels: [],
      evidence_ranges: [{ start_id: "s0", end_id: "s80" }],
    },
    source,
  );
  assert.ok(c.evidence.length > 1);
  assert.equal(
    c.evidence.map((e) => e.quote_original).join(" "),
    source.segments
      .slice(0, 81)
      .map((s) => s.text)
      .join(" "),
  );
  for (const e of c.evidence)
    assert.ok(
      e.source_span!.end_seconds! - e.source_span!.start_seconds! <= 120,
    );
  assert.throws(() =>
    recoverEvidenceRanges(
      { ...c, evidence_ranges: [{ start_id: "missing", end_id: "s80" }] },
      source,
    ),
  );
});
test("Flash Lite usage uses the current versioned input and output rates", () => {
  assert.equal(
    costUsd("gemini-3.1-flash-lite", {
      inputTokens: 1000000,
      outputTokens: 1000000,
    }),
    1.75,
  );
});

test("Listing resolution preserves the caption ticker and never converts a group or index into a listing", async () => {
  const { resolveListing } = await import(
    "../src/features/youtube-intelligence/identity.ts"
  );
  assert.equal(resolveListing("Coherent", "CHR")?.ticker, "COHR");
  assert.equal(resolveListing("Coherent", "CHR")?.captionTicker, "CHR");
  assert.equal(resolveListing("Lumentum", "LIT")?.ticker, "LITE");
  assert.equal(resolveListing("Nasdaq", null), null);
  assert.equal(resolveListing("Nvidia, Meta and Credo", null), null);
  assert.equal(resolveListing(null, "NOW"), null);
});

test("An unsupported ticker proposal is separated from an otherwise grounded company claim", async () => {
  const { normalizeReferences } = await import(
    "../src/features/youtube-intelligence/claim-references.ts"
  );
  const s = Source.parse({
    source_kind: "native_captions",
    segments: [
      {
        id: "a",
        text: "Lumenum ticker symbol LIT makes lasers.",
        start_seconds: 0,
        end_seconds: 5,
      },
    ],
  });
  const claim = recoverEvidenceRanges(
    {
      thesis_en: "Lumenum makes lasers",
      instrument_as_spoken: "Lumenum",
      ticker: "LITE",
      ticker_explicit: true,
      stance: "neutral",
      horizon_en: null,
      conditions_en: [],
      risks_en: [],
      creator_conviction: "unspecified",
      levels: [],
      evidence_ranges: [{ start_id: "a", end_id: "a" }],
    },
    s,
  );
  const normalized = normalizeReferences(claim, s);
  assert.equal(normalized.claim.ticker, null);
  assert.equal(normalized.tickerProposal, "LITE");
  assert.equal(claim.ticker, "LITE");
  assert.deepEqual(normalized.claim.evidence, claim.evidence);
});
