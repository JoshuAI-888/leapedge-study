import test from "node:test";
import assert from "node:assert/strict";
import {
  Source,
  Claim,
  anchorClaimEvidence,
  validateClaim,
  type Run,
} from "../src/features/youtube-intelligence/contracts.ts";
import {
  Entity,
  displayEntity,
  entityCorpus,
} from "../src/features/youtube-intelligence/entities.ts";
import {
  researchOutcome,
  canDropFailedAudit,
} from "../src/features/youtube-intelligence/research-quality.ts";
const make = (text: string) =>
  Claim.parse({
    thesis_en: "Do not buy above the limit.",
    instrument_as_spoken: "Company",
    ticker: null,
    ticker_explicit: false,
    stance: "conditional",
    horizon_en: null,
    conditions_en: [],
    creator_conviction: "unspecified",
    risks_en: [],
    levels: [],
    evidence: [
      {
        segment_id: "wrong-range",
        quote_original: text,
        quote_translation_en: "Translation",
      },
    ],
  });
test("Chinese caption formatting aligns to exact retained text; altered meanings and ambiguous matches fail closed", () => {
  const source = Source.parse({
    source_kind: "native_captions_test",
    segment_separator: "",
    segments: [
      { id: "a", text: "不 要 ", start_seconds: 0, end_seconds: 2 },
      { id: "b", text: "买 入20。", start_seconds: 2, end_seconds: 4 },
    ],
  });
  const result = anchorClaimEvidence(make("不要买入20。"), source);
  assert.equal(result.evidence[0].quote_original, "不 要 买 入20。");
  assert.equal(result.evidence[0].segment_id, "a");
  assert.equal(result.evidence[0].end_segment_id, "b");
  assert.deepEqual(validateClaim(result, source), []);
  for (const changed of ["要买入20。", "不要买入25。", "不要...20。"]) {
    const c = make(changed); // Negation deletion may be a real substring, so semantic audit must still reject it.
    if (changed !== "要买入20。")
      assert.ok(validateClaim(anchorClaimEvidence(c, source), source).length);
  }
  const repeated = Source.parse({
    ...source,
    segments: [
      ...source.segments,
      { id: "c", text: "不 要 买 入20。", start_seconds: 5, end_seconds: 9 },
    ],
  });
  assert.ok(
    validateClaim(anchorClaimEvidence(make("不要买入20。"), repeated), repeated)
      .length,
  );
});
test("English and numeric word boundaries are not removed during caption repair", () => {
  const source = Source.parse({
    source_kind: "native_captions_test",
    segment_separator: " ",
    segments: [
      {
        id: "a",
        text: "not buying 1 2 shares",
        start_seconds: 0,
        end_seconds: 5,
      },
    ],
  });
  assert.ok(
    validateClaim(
      anchorClaimEvidence(make("notbuying12shares"), source),
      source,
    ).length,
  );
});
test("English reviewed identity groups aliases without inventing ticker or mapping an index to ETF", () => {
  const entity = Entity.parse({
    id: "sofi",
    name: "SoFi Technologies",
    type: "Company",
    aliases: ["SoFi"],
    topics: ["Consumer Finance"],
    ticker: null,
    exchange: null,
    status: "reviewed",
    resolutionNote: "Analyst alias review",
  });
  assert.equal(
    displayEntity({ ...make("x"), instrument_as_spoken: "SoFi" }, [entity]).id,
    "sofi",
  );
  assert.equal(
    displayEntity({ ...make("x"), instrument_as_spoken: "纳斯达克" }, []).name,
    "Unresolved instrument or topic",
  );
  assert.equal(
    displayEntity({ ...make("x"), instrument_as_spoken: "Nasdaq" }, []).ticker,
    null,
  );
  assert.equal(Entity.safeParse({ ...entity, name: "戴尔" }).success, false);
  assert.equal(
    Entity.safeParse({ ...entity, ticker: "SOFI", exchange: null }).success,
    false,
  );
  assert.equal(
    Entity.safeParse({
      ...entity,
      type: "Theme",
      ticker: "SOFI",
      exchange: "NASDAQ",
    }).success,
    false,
  );
  const run = {
    id: "r",
    videoId: "v",
    output: {
      claims: [
        {
          id: "1",
          passed: true,
          claim: { ...make("x"), instrument_as_spoken: "SoFi" },
        },
        {
          id: "2",
          passed: true,
          claim: { ...make("x"), instrument_as_spoken: "SoFi Technologies" },
        },
      ],
    },
  } as unknown as Run;
  assert.equal(entityCorpus([run], [entity]).length, 1);
  assert.equal(entityCorpus([run], [entity])[0].rows.length, 2);
});
test("Empty research and budget failure cannot masquerade as successful evidence or claim recovery", () => {
  const run = {
    status: "completed",
    output: { claims: [{ passed: false }] },
  } as unknown as Run;
  assert.match(researchOutcome(run), /No verified evidence/);
  assert.equal(
    canDropFailedAudit({
      ...run,
      status: "failed",
      stage: "critique",
      error: "Local experiment budget limit reached.",
    }),
    false,
  );
});
test("A quoted below/under threshold cannot become an exact numeric entry", () => {
  const source = Source.parse({
    segments: [
      { id: "a", text: "I buy under $20.", start_seconds: 0, end_seconds: 3 },
    ],
  });
  const base = {
    ...make("I buy under $20."),
    evidence: [
      {
        segment_id: "a",
        quote_original: "I buy under $20.",
        quote_translation_en: "",
      },
    ],
  };
  assert.ok(
    validateClaim(
      { ...base, levels: [{ kind: "entry", value_original: "20" }] },
      source,
    ).some((x) => x.includes("comparator")),
  );
  assert.deepEqual(
    validateClaim(
      { ...base, levels: [{ kind: "entry", value_original: "under $20" }] },
      source,
    ),
    [],
  );
});
test("English synthesis fields reject Chinese while original source evidence remains unchanged", () => {
  const base = make("不要买入20。");
  assert.equal(Claim.safeParse(base).success, true);
  assert.equal(
    Claim.safeParse({ ...base, thesis_en: "不要买入" }).success,
    false,
  );
  assert.equal(
    Claim.safeParse({ ...base, conditions_en: ["低于20"] }).success,
    false,
  );
});
test("Preview origin is platform-defined, while production keeps configured origin", async () => {
  const { workspaceOrigin } =
    await import("../src/server/youtube-intelligence/access.ts");
  const prior = {
    env: process.env.VERCEL_ENV,
    url: process.env.VERCEL_URL,
    origin: process.env.YTI_APP_ORIGIN,
  };
  try {
    process.env.YTI_APP_ORIGIN = "https://prod.example";
    process.env.VERCEL_URL = "preview.example";
    process.env.VERCEL_ENV = "preview";
    assert.equal(workspaceOrigin(), "https://preview.example");
    process.env.VERCEL_ENV = "production";
    assert.equal(workspaceOrigin(), "https://prod.example");
  } finally {
    for (const [key, value] of Object.entries({
      VERCEL_ENV: prior.env,
      VERCEL_URL: prior.url,
      YTI_APP_ORIGIN: prior.origin,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
test('Read-only preview blocks mutations before they can enqueue model work',async()=>{
 const {guard}=await import('../src/server/youtube-intelligence/http.ts');const prior=process.env.YTI_PREVIEW_READ_ONLY;process.env.YTI_PREVIEW_READ_ONLY='true';
 try{assert.throws(()=>guard(new Request('http://127.0.0.1:3016/api/intelligence/research',{method:'POST'})),/read-only/);guard(new Request('http://127.0.0.1:3016/api/intelligence/research'));}finally{if(prior===undefined)delete process.env.YTI_PREVIEW_READ_ONLY;else process.env.YTI_PREVIEW_READ_ONLY=prior;}
});
