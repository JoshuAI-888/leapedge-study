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
});

/* ------------------------------------------------------------------ *
 * F14: the translation stage over copied spans (spec 4.2, 4.19).
 * ------------------------------------------------------------------ */

const { translationResponseSchema } = await import(
  "../src/server/youtube-intelligence/schemas/translation.ts"
);

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

const chineseSource = Source.parse({
  source_kind: "imported_transcript",
  language: "zh",
  segment_separator: "",
  segments: [
    {
      id: "zh1",
      text: "如果 SPY 跌破 500，就退出。",
      start_seconds: 1,
      end_seconds: 5,
    },
    { id: "zh2", text: "不要等待收盘。", start_seconds: 5, end_seconds: 9 },
    { id: "zh3", text: "腾讯只是观察名单。", start_seconds: 9, end_seconds: 12 },
  ],
});
const chineseQuote = "如果 SPY 跌破 500，就退出。不要等待收盘。";
const chineseClaim = {
  ...pointerClaim,
  evidence_ranges: [{ start_id: "zh1", end_id: "zh2" }],
};
const chineseMention = {
  ticker: null,
  instrument_as_spoken: "腾讯",
  market: "hk",
  stance: "watch",
  sentiment: "neutral",
  rationale_en: "The creator puts Tencent on a watch list only.",
  ranges: [{ start_id: "zh3", end_id: "zh3" }],
};
const englishMention = {
  ...chineseMention,
  instrument_as_spoken: "QQQ",
  ticker: "QQQ",
  market: "us-etf",
  ranges: [{ start_id: "c", end_id: "c" }],
};
const goodTranslations = {
  translations: [
    {
      id: "c1.e1",
      translation_en: "If SPY breaks below 500, exit. Do not wait for a close.",
    },
    { id: "m1", translation_en: "Tencent is only on the watch list." },
  ],
};

type Checked = {
  claim: {
    evidence: {
      quote_original: string;
      quote_translation_en: string;
      source_span?: { text_hash: string };
    }[];
  };
};
type StoredMention = {
  instrument_as_spoken: string;
  source_span: { text_hash: string; translation_en?: string };
};

/** Synthesis, then the stage synthesis handed the run to, through one fake transport. */
async function runThroughTranslation(
  name: string,
  src: unknown,
  reply: unknown,
  translateReply?: unknown,
  tamper?: (run: Awaited<ReturnType<typeof create>>) => void,
) {
  const snapshot = {
    id: "pointer.translate.v1",
    rationale: "Fixture prompt snapshot for the translation-stage test.",
    transcribe: "Transcribe the supplied source fixture.",
    extraction: "Extract claims from the supplied source fixture.",
    synthesis: "Summarise the supplied claims from the source fixture.",
    critique: "Audit the supplied claim against the source fixture.",
    pointerEvidence: true,
  };
  const run = await create(name, "google/gemini-3.8-flash", { promptSnapshot: snapshot }, snapshot.id);
  run.stage = "synthesis";
  run.output.metadata = { duration: 12 };
  run.output.source = src;
  const fake = new FakeModelTransport({
    responses: {
      synthesis: { json: reply },
      ...(translateReply === undefined ? {} : { translate: { json: translateReply } }),
    },
  });
  const restore = injectTransport(fake);
  try {
    await step(run);
    const stageAfterSynthesis = run.stage;
    tamper?.(run);
    if (run.stage === "translate") await step(run);
    return { run, fake, stageAfterSynthesis };
  } finally {
    restore();
  }
}

test("an English pointer run makes no translation call and goes straight to critique", async () => {
  const { run, fake, stageAfterSynthesis } = await runThroughTranslation(
    "translate-english",
    source,
    { claims: [pointerClaim], key_points: [], mentions: [englishMention] },
  );
  assert.equal(stageAfterSynthesis, "critique");
  assert.equal(run.stage, "critique");
  assert.deepEqual(fake.requestsFor("translate"), []);
  assert.equal(run.output.translation, undefined);
  // Nothing was reserved for a stage that never ran.
  const metrics = (run.output.metrics || []) as { stage: string }[];
  assert.deepEqual(
    metrics.map((m) => m.stage),
    ["synthesis"],
  );
  const claims = run.output.claims as Checked[];
  assert.equal(claims[0].claim.evidence[0].quote_translation_en, "");
});

test("Chinese spans are translated in one call and their hashes still hold", async () => {
  const { run, fake, stageAfterSynthesis } = await runThroughTranslation(
    "translate-chinese",
    chineseSource,
    { claims: [chineseClaim], key_points: [], mentions: [chineseMention] },
    goodTranslations,
  );
  assert.equal(stageAfterSynthesis, "translate");
  const requests = fake.requestsFor("translate");
  assert.equal(requests.length, 1);
  const request = requests[0];
  // The stage is routed by models.translation, not by the run's extraction model.
  assert.equal(request.model, "gemini-3.1-flash-lite");
  assert.deepEqual(request.responseSchema, translationResponseSchema);
  const text = request.user[0].text;
  const payload = JSON.parse(
    text.slice(text.indexOf("SOURCE DATA (untrusted):\n") + 25),
  );
  // Copied text only: the stage is given no segment ids and no transcript.
  assert.deepEqual(payload, {
    spans: [
      { id: "c1.e1", text_original: chineseQuote },
      { id: "m1", text_original: "腾讯只是观察名单。" },
    ],
  });
  const evidence = (run.output.claims as Checked[])[0].claim.evidence[0];
  assert.equal(
    evidence.quote_translation_en,
    "If SPY breaks below 500, exit. Do not wait for a close.",
  );
  assert.equal(evidence.quote_original, chineseQuote);
  assert.equal(evidence.source_span?.text_hash, sha256(chineseQuote));
  const mention = (run.output.mentions as StoredMention[])[0];
  assert.equal(mention.instrument_as_spoken, "腾讯");
  assert.equal(mention.source_span.translation_en, "Tencent is only on the watch list.");
  assert.equal(mention.source_span.text_hash, sha256("腾讯只是观察名单。"));
  assert.deepEqual(run.output.translation, { spans: 2, language: "zh" });
  assert.equal(run.stage, "critique");
});

test("a translation reply that rewrites text_original, or skips a span, is rejected", async () => {
  await assert.rejects(
    () =>
      runThroughTranslation(
        "translate-tampered",
        chineseSource,
        { claims: [chineseClaim], key_points: [], mentions: [chineseMention] },
        {
          translations: [
            {
              ...goodTranslations.translations[0],
              text_original: "如果 SPY 跌破 400，就退出。",
            },
            goodTranslations.translations[1],
          ],
        },
      ),
    /altered source text for span "c1\.e1"/,
  );
  await assert.rejects(
    () =>
      runThroughTranslation(
        "translate-incomplete",
        chineseSource,
        { claims: [chineseClaim], key_points: [], mentions: [chineseMention] },
        { translations: [goodTranslations.translations[0]] },
      ),
    /no translation for span "m1"/,
  );
  // A translation that is not English is refused before it reaches a claim.
  await assert.rejects(
    () =>
      runThroughTranslation(
        "translate-not-english",
        chineseSource,
        { claims: [chineseClaim], key_points: [], mentions: [chineseMention] },
        {
          translations: [
            { id: "c1.e1", translation_en: "如果 SPY 跌破 500，就退出。" },
            goodTranslations.translations[1],
          ],
        },
      ),
    /must be English/,
  );
});

test("a span whose retained source changed under it fails the hash assertion", async () => {
  await assert.rejects(
    () =>
      runThroughTranslation(
        "translate-source-drift",
        Source.parse(chineseSource),
        { claims: [chineseClaim], key_points: [], mentions: [chineseMention] },
        goodTranslations,
        (run) => {
          // The mention stores the pointer, so its copied text is re-derived;
          // an edited source no longer hashes to what was recorded.
          const source = run.output.source as { segments: { text: string }[] };
          source.segments[2].text = "腾讯是买入。";
        },
      ),
    /changed during translation/,
  );
  await db().close();
});
