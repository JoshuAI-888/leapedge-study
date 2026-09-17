import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.YTI_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "yti-pointer-")),
  "test.sqlite",
);
delete process.env.DATABASE_URL;
process.env.OPENROUTER_API_KEY = "fixture";
process.env.YTI_BUDGET_USD = "10";
const {
  deriveEvidence,
  validateClaim,
  Claim,
  Source,
} = await import("../src/features/youtube-intelligence/contracts.ts");
const { materializeEvidenceRanges } =
  await import("../src/features/youtube-intelligence/evidence-selection.ts");
const { extractionResponseSchema, PointerExtraction, parsePointerExtraction } =
  await import("../src/server/youtube-intelligence/schemas/extraction.ts");
const { FakeModelTransport } =
  await import("../src/server/youtube-intelligence/transport/fake.ts");
const { injectTransport } =
  await import("../src/server/youtube-intelligence/transport/index.ts");
const { create, db } =
  await import("../src/server/youtube-intelligence/store.ts");
const { step, extractionPayload } =
  await import("../src/server/youtube-intelligence/pipeline.ts");

const source = Source.parse({
  source_kind: "imported_transcript",
  segment_separator: " ",
  segments: [
    {
      id: "a",
      text: "If SPY breaks below 500, exit.",
      start_seconds: 1,
      end_seconds: 5,
    },
    { id: "b", text: "Do not wait for a close.", start_seconds: 5, end_seconds: 9 },
    { id: "c", text: "QQQ is only a watch.", start_seconds: 9, end_seconds: 12 },
  ],
});
const pointerClaim = {
  thesis_en: "Exit SPY on a break below 500.",
  instrument_as_spoken: "SPY",
  ticker: "SPY",
  ticker_explicit: true,
  stance: "conditional",
  horizon_en: null,
  conditions_en: ["break below 500"],
  creator_conviction: "unspecified",
  risks_en: [],
  levels: [{ kind: "stop", value_original: "500" }],
  evidence_ranges: [{ start_id: "a", end_id: "b" }],
};

test("deriveEvidence copies the exact source span and hashes it stably", () => {
  const derived = deriveEvidence(source, { start_id: "a", end_id: "b" });
  assert.equal(
    derived.quote_original,
    "If SPY breaks below 500, exit. Do not wait for a close.",
  );
  assert.equal(derived.start_seconds, 1);
  assert.equal(derived.end_seconds, 9);
  assert.equal(
    derived.text_hash,
    createHash("sha256").update(derived.quote_original).digest("hex"),
  );
  assert.deepEqual(deriveEvidence(source, { start_id: "a", end_id: "b" }), derived);
  const single = deriveEvidence(source, { start_id: "c", end_id: "c" });
  assert.equal(single.quote_original, "QQQ is only a watch.");
});

test("deriveEvidence rejects unknown, reversed and over-long ranges", () => {
  for (const span of [
    { start_id: "zz", end_id: "b" },
    { start_id: "a", end_id: "zz" },
    { start_id: "c", end_id: "a" },
  ])
    assert.throws(() => deriveEvidence(source, span));
  const long = Source.parse({
    source_kind: "imported_transcript",
    segments: Array.from({ length: 140 }, (_, i) => ({
      id: `s${i}`,
      text: `line ${i}. `,
      start_seconds: i,
      end_seconds: i + 1,
    })),
  });
  assert.throws(() => deriveEvidence(long, { start_id: "s0", end_id: "s120" }));
  assert.ok(deriveEvidence(long, { start_id: "s0", end_id: "s99" }).quote_original);
  const slow = Source.parse({
    source_kind: "imported_transcript",
    segments: [
      { id: "p", text: "one.", start_seconds: 0, end_seconds: 10 },
      { id: "q", text: "two.", start_seconds: 200, end_seconds: 400 },
    ],
  });
  assert.throws(() => deriveEvidence(slow, { start_id: "p", end_id: "q" }));
});

test("materializeEvidenceRanges records source_span with the derived quote", () => {
  const claim = materializeEvidenceRanges(pointerClaim, source);
  const span = claim.evidence[0].source_span;
  assert.ok(span);
  assert.equal(span.start_id, "a");
  assert.equal(span.end_id, "b");
  assert.equal(span.start_seconds, 1);
  assert.equal(span.end_seconds, 9);
  assert.equal(
    claim.evidence[0].quote_original,
    "If SPY breaks below 500, exit. Do not wait for a close.",
  );
  assert.equal(
    span.text_hash,
    createHash("sha256")
      .update(claim.evidence[0].quote_original)
      .digest("hex"),
  );
  assert.deepEqual(validateClaim(claim, source), []);
});

test("the extraction response schema and its parser accept ranges and reject a claim without them", () => {
  assert.equal(extractionResponseSchema.type, "object");
  const claims = (
    extractionResponseSchema.properties as Record<
      string,
      { items: { required: string[]; properties: Record<string, unknown> } }
    >
  ).claims.items;
  assert.ok(claims.required.includes("evidence_ranges"));
  assert.equal(
    (claims.properties.evidence_ranges as { minItems: number }).minItems,
    1,
  );
  for (const field of [
    "thesis_en",
    "stance",
    "creator_conviction",
    "levels",
    "ticker",
    "ticker_explicit",
  ])
    assert.ok(field in claims.properties, `${field} missing from the schema`);
  assert.ok(!("evidence" in claims.properties));
  assert.equal(JSON.stringify(extractionResponseSchema).includes("quote_original"), false);
  const parsed = parsePointerExtraction({ claims: [pointerClaim] });
  assert.equal(parsed.claims[0].evidence_ranges[0].end_id, "b");
  assert.deepEqual(parsed.key_points, []);
  const { evidence_ranges, ...withoutRanges } = pointerClaim;
  assert.throws(() => parsePointerExtraction({ claims: [withoutRanges] }));
  assert.throws(() =>
    parsePointerExtraction({
      claims: [{ ...pointerClaim, evidence_ranges: [] }],
    }),
  );
  assert.equal(PointerExtraction.safeParse({ claims: [pointerClaim] }).success, true);
});

test("validateClaim records a stale pointer span as a warning, never a rejection", () => {
  const materialized = materializeEvidenceRanges(pointerClaim, source);
  const tampered = Claim.parse({
    ...materialized,
    evidence: [
      {
        ...materialized.evidence[0],
        quote_original: "If SPY breaks below 500, exit. Do not wait for a close.",
        source_span: {
          ...materialized.evidence[0].source_span!,
          text_hash: "0".repeat(64),
        },
      },
    ],
  });
  const warnings: string[] = [];
  assert.deepEqual(validateClaim(tampered, source, warnings), []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /a\.\.b/);
  const legacy = Claim.parse({
    ...materialized,
    evidence: [
      {
        segment_id: "a",
        quote_original: "a quote the source never contained",
        quote_translation_en: "",
      },
    ],
  });
  const legacyWarnings: string[] = [];
  assert.ok(
    validateClaim(legacy, source, legacyWarnings).includes(
      "Quote does not match the retained source.",
    ),
  );
  assert.deepEqual(legacyWarnings, []);
});

async function runSynthesis(pointerEvidence: boolean, reply: unknown) {
  const model = "google/gemini-3.8-flash";
  const snapshot = {
    id: pointerEvidence ? "pointer.test.v1" : "evidence-first.web.v5",
    rationale: "Fixture prompt snapshot for the pointer-evidence test.",
    transcribe: "Transcribe the supplied source fixture.",
    extraction: "Extract claims from the supplied source fixture.",
    synthesis: "Summarise the supplied claims from the source fixture.",
    critique: "Audit the supplied claim against the source fixture.",
    ...(pointerEvidence ? { pointerEvidence: true } : {}),
  };
  const run = await create(
    pointerEvidence ? "pointer-run" : "legacy-run",
    model,
    { promptSnapshot: snapshot },
    snapshot.id,
  );
  run.stage = "synthesis";
  run.output.metadata = { duration: 12 };
  run.output.source = source;
  const fake = new FakeModelTransport({
    responses: { synthesis: { json: reply } },
  });
  const restore = injectTransport(fake);
  try {
    await step(run);
  } finally {
    restore();
  }
  return { run, fake };
}

test("a pointer-evidence synthesis step copies spans and never rejects on a string match", async () => {
  const { run, fake } = await runSynthesis(true, {
    claims: [pointerClaim],
    key_points: [],
  });
  const request = fake.requestsFor("synthesis")[0];
  assert.deepEqual(request.responseSchema, extractionResponseSchema);
  const claims = run.output.claims as {
    claim: { evidence: { quote_original: string; source_span?: { start_id: string } }[] };
    reasons: string[];
  }[];
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].reasons, []);
  assert.equal(claims[0].claim.evidence[0].source_span?.start_id, "a");
  assert.equal(
    claims[0].claim.evidence[0].quote_original,
    "If SPY breaks below 500, exit. Do not wait for a close.",
  );
  assert.equal(run.output.validationVersion, "pointer-evidence.v1");
  assert.equal(run.stage, "critique");
});

test("a v5 run through the same fake keeps the legacy quote path unchanged", async () => {
  const legacyClaim = {
    ...pointerClaim,
    evidence: [
      {
        segment_id: "a",
        quote_original: "If SPY breaks below 500, exit.",
        quote_translation_en: "",
      },
    ],
  };
  const { evidence_ranges, ...fields } = legacyClaim;
  const badQuote = {
    ...fields,
    thesis_en: "An unsupported thesis about SPY below 500.",
    evidence: [
      {
        segment_id: "a",
        quote_original: "SPY collapses to 400 tomorrow",
        quote_translation_en: "",
      },
    ],
  };
  const { run, fake } = await runSynthesis(false, {
    claims: [fields, badQuote],
    key_points: [],
  });
  const request = fake.requestsFor("synthesis")[0];
  assert.equal(request.responseSchema, undefined);
  const text = request.user[0].text;
  const payload = JSON.parse(
    text.slice(text.indexOf("SOURCE DATA (untrusted):\n") + 25),
  );
  assert.deepEqual(payload, extractionPayload(source.segments, 0, 1));
  const claims = run.output.claims as {
    claim: { evidence: { source_span?: unknown }[] };
    reasons: string[];
  }[];
  assert.equal(claims.length, 2);
  assert.deepEqual(claims[0].reasons, []);
  assert.equal(claims[0].claim.evidence[0].source_span, undefined);
  assert.ok(
    claims[1].reasons.includes("Quote does not match the retained source."),
  );
  assert.equal(run.output.validationVersion, "caption-alignment.v2");
  assert.equal(run.output.warnings, undefined);
  assert.equal(run.stage, "critique");
  await db().close();
});
