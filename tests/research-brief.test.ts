import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analysisContext,
  eligibleExternal,
  validateBrief,
  financialCheck,
  prioritiseBriefs,
  evidenceInventory,
  extractionContext,
  actionRecallWindows,
} from "../src/features/youtube-intelligence/research-brief.ts";
import type { Run } from "../src/features/youtube-intelligence/contracts.ts";
const run = {
  id: "run",
  videoId: "video",
  createdAt: "2026-09-20T00:00:00Z",
  output: {
    metadata: { publishedAt: "2026-04-10T01:16:13Z" },
    source: {
      segments: [
        { id: "s1", text: "I hold shares", start_seconds: 0, end_seconds: 4 },
      ],
    },
    claims: [
      {
        id: "c1",
        passed: true,
        reasons: [],
        audit: { verdict: "accept" },
        claim: {
          instrument_as_spoken: "Company",
          ticker: null,
          thesis_en: "The creator holds shares.",
          evidence: [{ segment_id: "s1", quote_original: "I hold shares" }],
        },
      },
    ],
  },
} as unknown as Run;
const sentence = {
  id: "s1",
  text: "The creator holds shares.",
  evidenceIds: ["c1"],
  externalIds: [],
  kind: "creator_view",
  horizon: "fundamental" as const,
  topic: "Company",
  materiality: 2,
  importanceReason: "Existing position",
  speaker: "unknown",
  timeMode: "video_date",
};
test("analysis cutoff is publication time, never the later processing date", () => {
  const context = analysisContext(run);
  assert.equal(context.videoPublishedAt, "2026-04-10T01:16:13Z");
  assert.equal(context.recordedAt, null);
  assert.equal(analysisContext({ ...run, output: {} }).videoPublishedAt, null);
  assert.equal(
    eligibleExternal(
      { publishedAt: "2026-04-11T00:00:00Z", publicationConfirmed: true },
      context,
      "video_date",
    ),
    false,
  );
  assert.equal(
    eligibleExternal(
      { publishedAt: "2026-04-09T00:00:00Z", publicationConfirmed: false },
      context,
      "video_date",
    ),
    false,
  );
  assert.equal(
    eligibleExternal(
      { publishedAt: "2026-04-11T00:00:00Z", publicationConfirmed: true },
      context,
      "current",
    ),
    true,
  );
});
test("brief rejects invented citations, unconfirmed historical sources and missing audit verdicts", () => {
  const source = evidenceInventory(run);
  const context = analysisContext(run);
  const raw = {
    sentences: [
      sentence,
      { ...sentence, id: "bad", evidenceIds: ["invented"] },
    ],
    mainTopics: ["Company"],
    omissions: [],
  };
  const result = validateBrief(raw, source, [], context, [
    {
      id: "s1",
      accepted: true,
      reason: "Supported",
      factualStatus: "unverified",
    },
    {
      id: "bad",
      accepted: true,
      reason: "Unsupported",
      factualStatus: "unverified",
    },
  ]);
  assert.deepEqual(
    result.sentences.map((s) => s.id),
    ["s1"],
  );
  assert.equal(result.rejected.length, 1);
  assert.equal(validateBrief(raw, source, [], context, []).sentences.length, 0);
  assert.throws(
    () =>
      validateBrief(raw, source, [], context, [
        {
          id: "s1",
          accepted: true,
          reason: "yes",
          factualStatus: "unverified",
        },
        {
          id: "s1",
          accepted: true,
          reason: "yes",
          factualStatus: "unverified",
        },
      ]),
    /duplicate/i,
  );
});
test("a primary-source badge cannot be granted from transcript agreement alone", () => {
  const result = validateBrief(
    { sentences: [sentence], mainTopics: ["Company"], omissions: [] },
    evidenceInventory(run),
    [],
    analysisContext(run),
    [
      {
        id: "s1",
        accepted: true,
        reason: "Quote agrees",
        factualStatus: "corroborated",
      },
    ],
  );
  assert.equal(result.sentences[0].factualStatus, "unverified");
});
test("extraction context includes prior section without changing original cues", () => {
  const segments = Array.from({ length: 40 }, (_, i) => ({
    id: "s" + i,
    text: i === 5 ? "Stocks I will buy now" : "text",
    start_seconds: i * 3,
    end_seconds: i * 3 + 3,
  }));
  const r = { ...run, output: { ...run.output, source: { segments } } };
  const payload = extractionContext(r, segments.slice(20));
  assert.ok(payload.previousSection.some((s) => s.id === "s5"));
  assert.equal(segments[5].text, "Stocks I will buy now");
});
test("financial checks compute units and reject invalid domains instead of inventing assumptions", () => {
  assert.ok(
    Math.abs(
      financialCheck({ kind: "cagr", initial: 1.6, final: 32.5, years: 10 })
        .value! - 0.3513,
    ) < 0.001,
  );
  assert.equal(
    financialCheck({ kind: "cagr", initial: 0, final: 32.5, years: 10 }).value,
    null,
  );
  assert.equal(
    financialCheck({ kind: "market_cap", earnings: 32.5, multiple: 40 }).value,
    1300,
  );
  assert.equal(
    financialCheck({
      kind: "short_put_breakeven",
      strike: 165,
      premiumPerShare: 12,
    }).value,
    153,
  );
});
test("ranking favours material recent developments, labels backfills and never invents novelty", () => {
  const old = {
    id: "old",
    videoId: "oldvideo",
    publishedAt: "2026-04-01T00:00:00Z",
    createdAt: "2026-09-20T00:00:00Z",
    sentences: [{ ...sentence, materiality: 3 }],
    status: "completed",
  };
  const recent = {
    ...old,
    id: "new",
    videoId: "newvideo",
    publishedAt: "2026-09-19T00:00:00Z",
  };
  const ranked = prioritiseBriefs(
    [old, recent],
    [],
    new Date("2026-09-20T00:00:00Z"),
  );
  assert.equal(ranked[0].id, "new");
  assert.equal(ranked[1].backfill, true);
  assert.equal(ranked[0].novelty, "unknown");
  assert.ok(ranked[0].rankingReasons.length);
});

test("an unsupported optional calculation is withheld with a visible limitation without losing the cited draft", async () => {
  const { parseResearchDraft } = await import(
    "../src/features/youtube-intelligence/research-brief.ts"
  );
  const result = parseResearchDraft({
    sentences: [
      {
        ...sentence,
        calculation: {
          expression: { kind: "discounted_cash_flow", initial: 10, final: 20 },
          units: "percent",
          assumptions: "Same basis",
        },
      },
    ],
    mainTopics: ["Company"],
    omissions: [],
  });
  assert.equal(result.sentences.length, 1);
  assert.equal(result.sentences[0].calculation, null);
  assert.match(result.omissions[0], /calculation.*withheld/i);
  assert.throws(() =>
    parseResearchDraft({
      sentences: [{ ...sentence, evidenceIds: [] }],
      mainTopics: [],
      omissions: [],
    }),
  );
});

test("overlong topic navigation does not discard supported content", async () => {
  const { parseResearchDraft } = await import(
    "../src/features/youtube-intelligence/research-brief.ts"
  );
  const parsed = parseResearchDraft({
    sentences: [sentence],
    mainTopics: Array.from({ length: 10 }, (_, i) => "Topic " + i),
    omissions: [],
  });
  assert.equal(parsed.mainTopics.length, 10);
  assert.equal(parsed.sentences.length, 1);
});

test("a future-dated video cannot admit a source published after analysis time", () => {
  const context = {
    ...analysisContext(run),
    videoPublishedAt: "2027-01-01T00:00:00Z",
  };
  assert.equal(
    eligibleExternal(
      { publishedAt: "2026-12-31T00:00:00Z", publicationConfirmed: true },
      context,
      "video_date",
    ),
    false,
  );
});

test("typed arithmetic distinguishes enterprise value, percentages and option contract cash", () => {
  assert.equal(
    financialCheck({
      kind: "enterprise_value_bridge",
      equityValue: 100,
      debt: 30,
      cash: 12,
      preferred: 2,
      nonControllingInterest: 1,
    }).value,
    121,
  );
  assert.equal(
    financialCheck({
      kind: "percentage_point_change",
      initialPercent: 10,
      finalPercent: 12,
    }).value,
    2,
  );
  assert.equal(
    financialCheck({ kind: "percentage_change", initial: 10, final: 12 }).value,
    0.2,
  );
  assert.equal(
    financialCheck({
      kind: "option_premium_total",
      premiumPerShare: 12,
      contractMultiplier: 100,
      contracts: 2,
    }).value,
    2400,
  );
});
test("novelty requires a dated prior baseline and an independent novelty verdict", () => {
  const raw = {
    sentences: [
      {
        ...sentence,
        novelty: {
          status: "new_detail",
          baselineIds: ["prior"],
          reason: "Adds a disclosed holding to earlier company research.",
        },
      },
    ],
    mainTopics: ["Company"],
    omissions: [],
  };
  const audit = [
    {
      id: "s1",
      accepted: true,
      reason: "Holding supported",
      factualStatus: "unverified" as const,
      noveltyAccepted: true,
    },
  ];
  const absent = validateBrief(
    raw,
    evidenceInventory(run),
    [],
    analysisContext(run),
    audit,
  );
  assert.equal(absent.sentences[0].novelty.status, "unknown");
  const baseline = [
    {
      id: "prior",
      sourceRunId: "older",
      publishedAt: "2026-04-09T00:00:00Z",
      topic: "Company",
      text: "Avoid new purchases.",
      evidence: evidenceInventory(run),
    },
  ];
  assert.equal(
    validateBrief(
      raw,
      evidenceInventory(run),
      [],
      analysisContext(run),
      audit,
      baseline,
    ).sentences[0].novelty.status,
    "new_detail",
  );
  assert.equal(
    validateBrief(
      raw,
      evidenceInventory(run),
      [],
      analysisContext(run),
      [{ ...audit[0], noveltyAccepted: false }],
      baseline,
    ).sentences[0].novelty.status,
    "unknown",
  );
});

test("overflowing valuation arithmetic is unavailable rather than an infinite target", () => {
  assert.equal(
    financialCheck({ kind: "market_cap", earnings: 1e308, multiple: 1e308 })
      .value,
    null,
  );
});

test('recall windows cover an explicit stance split across cues but exclude already-cited action cues',async()=>{
 const {actionRecallWindows}=await import('../src/features/youtube-intelligence/research-brief.ts');
 const source={segments:[{id:'a',text:'CoreWeave is one of my favorites. I am',start_seconds:0,end_seconds:3},{id:'b',text:'bullish on CoreWeave.',start_seconds:3,end_seconds:6},{id:'c',text:'It has active power and dilution risks.',start_seconds:6,end_seconds:9}]};
 const r={...run,output:{source,claims:[]}};
 assert.ok(actionRecallWindows(r).some(w=>w.some(c=>c.id==='b')));
 const covered={...r,output:{...r.output,claims:[{id:'c1',passed:true,reasons:[],claim:{evidence:[{segment_id:'a',end_segment_id:'c'}]}}]}} as unknown as Run;
 assert.equal(actionRecallWindows(covered).length,0);
});

test('unsupported external verification cannot leak a contradictory audit explanation or robustness label', () => {
  const result = validateBrief(
    { sentences: [sentence], mainTopics: ['Company'], omissions: [] },
    evidenceInventory(run), [], analysisContext(run),
    [{id:'s1',accepted:true,reason:'External yield contradicts the video',factualStatus:'partial',robustness:'fragile',robustnessReason:'External yield differs'}],
  );
  assert.equal(result.sentences[0].factualStatus,'unverified');
  assert.equal(result.sentences[0].robustness,'insufficient');
  assert.doesNotMatch(result.sentences[0].auditReason,/yield contradicts/);
  assert.match(result.sentences[0].auditReason,/withheld/);
});

test('a quoted but arithmetically inconsistent short-put breakeven cannot become a headline', () => {
  const evidence=evidenceInventory(run);
  evidence[0].quotes[0].text='165 minus $1.85 gets you a break even of effectively 153';
  const item={...sentence,text:'The 165 put less $1.85 premium gives a $153 breakeven.',
    financialFacts:[{label:'Put breakeven price',value:153,currency:'USD',unit:'per_share',scale:'ones',period:null,basis:'not_stated',nature:'scenario',evidenceId:'c1',quote:evidence[0].quotes[0].text}],
    calculation:{expression:{kind:'short_put_breakeven',strike:165,premiumPerShare:1.85},units:'USD per share',assumptions:'Before fees'},
  };
  const validate=(draft:unknown)=>validateBrief({sentences:[draft],mainTopics:['Company'],omissions:[]},evidence,[],analysisContext(run),[{id:'s1',accepted:true,reason:'faithful quotation',factualStatus:'unverified'}]);
  const rejected=validate(item);
  assert.equal(rejected.sentences.length,0);
  assert.match(rejected.rejected[0].reasons.join(' '),/breakeven.*163\.15/i);
  assert.equal(validate({...item,text:'Calculated breakeven is $163.15.',financialFacts:[]}).sentences.length,1);
  for (const text of ['Calculated breakeven is $153.15.', 'A $153.15 breakeven follows from the option inputs.', 'Breakeven of USD 153.15 is below the downside floor.']) {
    assert.equal(validate({...item,text,financialFacts:[]}).sentences.length,0, text);
  }
});

test('eligible primary URL without assertion-level support cannot confer corroboration', () => {
 const external={id:'x1',url:'https://example.com/report',title:'Primary',text:'Revenue increased 10%.',publishedAt:'2026-04-01T00:00:00Z',retrievedAt:'2026-09-20T00:00:00Z',publicationConfirmed:true,dateBasis:'fixture',sourceClass:'primary' as const,hash:'fixture',query:'fixture',timeMode:'video_date' as const,provider:'fixture'};
 const s={...sentence,externalIds:['x1']};
 const result=validateBrief({sentences:[s],mainTopics:['Company'],omissions:[]},evidenceInventory(run),[external],analysisContext(run),[{id:'s1',accepted:true,reason:'The cited source does not substantiate the holding.',factualStatus:'partial'}]);
 assert.equal(result.sentences[0].factualStatus,'unverified');
});

test('corroboration requires an exact retained passage and the assertion being assessed', () => {
 const external={id:'x1',url:'https://example.com/report',title:'Primary',text:'The creator holds shares.',publishedAt:'2026-04-01T00:00:00Z',retrievedAt:'2026-09-20T00:00:00Z',publicationConfirmed:true,dateBasis:'fixture',sourceClass:'primary' as const,hash:'fixture',query:'fixture',timeMode:'video_date' as const,provider:'fixture'};
 const check=(quote:string,assertion=sentence.text)=>validateBrief({sentences:[{...sentence,externalIds:['x1']}],mainTopics:['Company'],omissions:[]},evidenceInventory(run),[external],analysisContext(run),[{id:'s1',accepted:true,reason:'Exact holding independently reported.',factualStatus:'corroborated',externalSupport:[{externalId:'x1',assertion,quote,relationship:'supports',reason:'Same holder and position.',comparability:{metric:'matched',period:'matched',units:'not_applicable',observationBasis:'matched',reason:'Same holder, position and as-of date.'}}]}]);
 assert.equal(check('Fabricated passage').sentences[0].factualStatus,'unverified');
 assert.equal(check(external.text,'Unrelated assertion').sentences[0].factualStatus,'unverified');
 assert.equal(check(external.text).sentences[0].factualStatus,'corroborated');
});


test("an old filing cannot be relabelled as a subsequent current update", () => {
 assert.equal(eligibleExternal({publishedAt:"2026-04-09T00:00:00Z",publicationConfirmed:true},analysisContext(run),"current"),false);
});

test('supplementary recall also examines non-action valuation and moat qualifications',async()=>{
 const {actionRecallWindows}=await import('../src/features/youtube-intelligence/research-brief.ts');
 const r={...run,output:{source:{segments:[{id:'a',text:'Dutch Bros lacks a sustainable moat; valuation only works at a low entry price.',start_seconds:0,end_seconds:8}]},claims:[]}};
 assert.equal(actionRecallWindows(r).length,1);
});

test('a day-only publication cannot prove it happened after a video earlier the same day',()=>{
 const context={...analysisContext(run),videoPublishedAt:'2026-04-10T12:00:00Z'};
 assert.equal(eligibleExternal({publishedAt:'2026-04-10T23:59:59.999Z',publicationConfirmed:true},context,'current'),false);
 assert.equal(eligibleExternal({publishedAt:'2026-04-11T23:59:59.999Z',publicationConfirmed:true},context,'current'),true);
});

test('a supported clause cannot hide a contradictory material clause behind a partial label',()=>{
 const text='Revenue rose, but margins expanded.';
 const external={id:'x1',url:'https://example.com/report',title:'Primary',text:'Revenue rose. Margins declined.',publishedAt:'2026-04-01T00:00:00Z',retrievedAt:'2026-09-20T00:00:00Z',publicationConfirmed:true,publicationPrecision:'day' as const,dateBasis:'fixture',sourceClass:'primary' as const,hash:'fixture',query:'fixture',timeMode:'video_date' as const,provider:'fixture'};
 const result=validateBrief({sentences:[{...sentence,text,externalIds:['x1']}],mainTopics:['Company'],omissions:[]},evidenceInventory(run),[external],analysisContext(run),[{id:'s1',accepted:true,reason:'Mixed support',factualStatus:'partial',externalSupport:[{externalId:'x1',assertion:'Revenue rose',quote:'Revenue rose.',relationship:'supports',reason:'Same period.',comparability:{metric:'matched',period:'matched',units:'matched',observationBasis:'matched',reason:'Same revenue definition and period.'}},{externalId:'x1',assertion:'margins expanded',quote:'Margins declined.',relationship:'contradicts',reason:'Same period and margin basis.',comparability:{metric:'matched',period:'matched',units:'matched',observationBasis:'matched',reason:'Same margin definition, fiscal period and percent units.'}}]}]);
 assert.equal(result.sentences[0].factualStatus,'disputed');assert.equal(result.sentences[0].robustness,'fragile');
});

test('Chinese old-to-new share count cannot be published with a reversed stock-split ratio', () => {
 const evidence=evidenceInventory(run);evidence[0].quotes[0].text='公司宣布1股拆3股，下月实施。';
 const result=validateBrief({sentences:[{...sentence,text:'The company announced a 1-for-3 stock split.'}],mainTopics:['Company'],omissions:[]},evidence,[],analysisContext(run),[{id:'s1',accepted:true,reason:'Model accepted',factualStatus:'unverified'}]);
 assert.equal(result.sentences.length,0);assert.equal(result.rejected[0].sentence.text,'The company announced a 1-for-3 stock split.');assert.match(result.rejected[0].reasons.join(' '),/stock.split.*direction/i);assert.equal(evidence[0].quotes[0].text,'公司宣布1股拆3股，下月实施。');
});
test('matching Chinese and explicit English stock-split directions remain reviewable', () => {
 for(const quote of ['公司宣布1股拆3股。','The company announced a three-for-one stock split.','Each existing share will be split into three new shares.']){
  const evidence=evidenceInventory(run);evidence[0].quotes[0].text=quote;
  const result=validateBrief({sentences:[{...sentence,text:'The company announced a 3-for-1 stock split.'}],mainTopics:['Company'],omissions:[]},evidence,[],analysisContext(run),[{id:'s1',accepted:true,reason:'Model accepted',factualStatus:'unverified'}]);
  assert.equal(result.sentences.length,1,quote);
  assert.deepEqual(result.omissions,[],quote);
  const reversed=validateBrief({sentences:[{...sentence,text:'The company announced a 1-for-3 stock split.'}],mainTopics:['Company'],omissions:[]},evidence,[],analysisContext(run),[{id:'s1',accepted:true,reason:'Model accepted',factualStatus:'unverified'}]);
  assert.equal(reversed.sentences.length,0,quote);
 }
});
test('unambiguous English reverse split rejects a forward split and ambiguity does not invent a ratio', () => {
 const check=(quote:string,text:string)=>{const evidence=evidenceInventory(run);evidence[0].quotes[0].text=quote;return validateBrief({sentences:[{...sentence,text}],mainTopics:['Company'],omissions:[]},evidence,[],analysisContext(run),[{id:'s1',accepted:true,reason:'Model accepted',factualStatus:'unverified'}]);};
 assert.equal(check('The company announced a 1-for-3 reverse stock split.','The company announced a 3-for-1 stock split.').sentences.length,0);
 const ambiguous=check('公司拆股比例是1比3。','The company announced a 1-for-3 stock split.');
 assert.equal(ambiguous.sentences.length,1);assert.ok(ambiguous.omissions.some(note=>/direction.*unresolved/i.test(note)));assert.ok(!ambiguous.omissions.some(note=>note.includes('3-for-1')));
 const multiple=check('A announced a 3-for-1 stock split; B announced a 1-for-3 stock split.','The company announced a 3-for-1 stock split.');
 assert.equal(multiple.sentences.length,1);assert.ok(multiple.omissions.some(note=>/direction.*unresolved/i.test(note)));
});
test('explicit percentage-point source units cannot become percent in a typed fact', () => {
 const evidence=evidenceInventory(run);evidence[0].quotes[0].text='利润率提高了1个百分点。';
 const result=validateBrief({sentences:[{...sentence,text:'Margin increased 1 percent.',financialFacts:[{label:'Margin change',value:1,currency:null,unit:'percent',scale:'ones',period:null,basis:'not_stated',nature:'reported',evidenceId:'c1',quote:'利润率提高了1个百分点。'}]}],mainTopics:['Company'],omissions:[]},evidence,[],analysisContext(run),[{id:'s1',accepted:true,reason:'Model accepted',factualStatus:'unverified'}]);
 assert.equal(result.sentences.length,0);assert.match(result.rejected[0].reasons.join(' '),/percentage.points.*percent/i);
});
test('a quote containing both percent and percentage-point facts does not invent a unit conflict', () => {
 const evidence=evidenceInventory(run);evidence[0].quotes[0].text='利润率为10%，提高了1个百分点。';
 const result=validateBrief({sentences:[{...sentence,text:'Margin is 10 percent.',financialFacts:[{label:'Margin',value:10,currency:null,unit:'percent',scale:'ones',period:null,basis:'not_stated',nature:'reported',evidenceId:'c1',quote:evidence[0].quotes[0].text}]}],mainTopics:['Company'],omissions:[]},evidence,[],analysisContext(run),[{id:'s1',accepted:true,reason:'Model accepted',factualStatus:'unverified'}]);
 assert.equal(result.sentences.length,1);
});

const comparableObservation = {metric:'matched' as const,period:'matched' as const,units:'matched' as const,observationBasis:'matched' as const,reason:'Same instrument, date, units and closing observation convention established from both sources.'};
const yieldExternal = {id:'x1',url:'https://example.com/h15',title:'H15',text:'10-year constant maturity yield: 4.94%.',publishedAt:'2026-04-01T00:00:00Z',retrievedAt:'2026-09-20T00:00:00Z',publicationConfirmed:true,dateBasis:'fixture',sourceClass:'primary' as const,hash:'fixture',query:'fixture',timeMode:'video_date' as const,provider:'fixture'};
function yieldComparison(comparability?: {metric:"matched"|"not_applicable"|"unknown"|"mismatched";period:"matched"|"not_applicable"|"unknown"|"mismatched";units:"matched"|"not_applicable"|"unknown"|"mismatched";observationBasis:"matched"|"not_applicable"|"unknown"|"mismatched";reason:string},quote=yieldExternal.text) {
 const text='The 10-year Treasury yield pulled back to 4.93%.';
 return validateBrief({sentences:[{...sentence,text,externalIds:['x1']}],mainTopics:['Company'],omissions:[]},evidenceInventory(run),[yieldExternal],analysisContext(run),[{id:'s1',accepted:true,reason:'The numerical gap may reflect different conventions, not a proven contradiction.',factualStatus:'disputed',robustness:'fragile',robustnessReason:'Yield differs by one basis point.',externalSupport:[{externalId:'x1',assertion:text,quote,relationship:'contradicts',reason:'The observation basis is not confirmed identical; this is not conclusively proven to be a contradiction.',...(comparability?{comparability}: {})}]}]);
}
test('unknown Treasury observation convention withholds disputed and fragile while preserving potential conflict passage',()=>{
 const result=yieldComparison({...comparableObservation,observationBasis:'unknown'});
 assert.equal(result.sentences[0].factualStatus,'unverified');assert.equal(result.sentences[0].robustness,'insufficient');
 assert.equal(result.sentences[0].externalSupport?.length,1);assert.equal(result.sentences[0].externalSupport?.[0].quote,yieldExternal.text);
 assert.match(result.sentences[0].auditReason,/comparab|convention/i);
});
test('legacy absent comparability defaults unknown without dropping its retained evidence',()=>{
 const result=yieldComparison();assert.equal(result.sentences[0].factualStatus,'unverified');
 assert.equal(result.sentences[0].externalSupport?.[0].comparability.observationBasis,'unknown');
});
test('numeric conflicts require all four comparison dimensions matched, including units and basis',()=>{
 for(const dimension of ['metric','period','units','observationBasis']) for(const status of ['unknown','mismatched','not_applicable'] as const) {
  const result=yieldComparison({...comparableObservation,[dimension]:status});assert.equal(result.sentences[0].factualStatus,'unverified',`${dimension}:${status}`);
 }
 assert.equal(yieldComparison(comparableObservation).sentences[0].factualStatus,'disputed');
 assert.equal(yieldComparison(comparableObservation).sentences[0].robustness,'fragile');
 assert.equal(yieldComparison(comparableObservation,'Fabricated quote').sentences[0].factualStatus,'unverified');
});

test('numerical support with unknown or mismatched measurement cannot corroborate or partially confirm',()=>{
 const text='The 10-year Treasury yield was 4.94%.';
 for(const label of ['corroborated','partial'] as const) for(const status of ['unknown','mismatched','not_applicable'] as const) {
  const result=validateBrief({sentences:[{...sentence,text,externalIds:['x1']}],mainTopics:['Company'],omissions:[]},evidenceInventory(run),[yieldExternal],analysisContext(run),[{id:'s1',accepted:true,reason:'Same-looking yield.',factualStatus:label,externalSupport:[{externalId:'x1',assertion:text,quote:yieldExternal.text,relationship:'supports',reason:'May be different observation convention.',comparability:{...comparableObservation,observationBasis:status}}]}]);
  assert.equal(result.sentences[0].factualStatus,'unverified',`${label}:${status}`);assert.equal(result.sentences[0].externalSupport?.length,1);
 }
});

test('explicitly comparable quantitative support can confirm while an unresolved conflict still blocks promotion',()=>{
 const text='The 10-year Treasury yield was 4.94%.';
 const support={externalId:'x1',assertion:text,quote:yieldExternal.text,relationship:'supports' as const,reason:'Same constant-maturity observation.',comparability:comparableObservation};
 const check=(conflict=false)=>validateBrief({sentences:[{...sentence,text,externalIds:['x1']}],mainTopics:['Company'],omissions:[]},evidenceInventory(run),[yieldExternal],analysisContext(run),[{id:'s1',accepted:true,reason:'Compared exact observation.',factualStatus:'corroborated',externalSupport:[support,...(conflict?[{...support,relationship:'contradicts' as const,comparability:{...comparableObservation,period:'unknown' as const}}]:[])]}]);
 assert.equal(check().sentences[0].factualStatus,'corroborated');assert.equal(check(true).sentences[0].factualStatus,'unverified');assert.equal(check(true).sentences[0].externalSupport?.length,2);
});

test('matched comparison flags without a comparison reason do not manufacture certainty',()=>{
 const {reason: _reason,...incomplete}=comparableObservation;
 const result=validateBrief({sentences:[{...sentence,text:'The yield was 4.93%.',externalIds:['x1']}],mainTopics:['Company'],omissions:[]},evidenceInventory(run),[yieldExternal],analysisContext(run),[{id:'s1',accepted:true,reason:'Matched flags alone.',factualStatus:'disputed',externalSupport:[{externalId:'x1',assertion:'The yield was 4.93%.',quote:yieldExternal.text,relationship:'contradicts',reason:'Different yield.',comparability:incomplete}]}]);
 assert.equal(result.sentences[0].factualStatus,'unverified');
});

test('recall revisits rejected core holding and sector reluctance split across Vistra caption cues',()=>{
 const cues=[
  {id:'s00031',text:"business's cash flow. You also need to",start_seconds:77.24,end_seconds:80.64},
  {id:'s00032',text:'jump through hoops to figure out',start_seconds:79.24,end_seconds:83.08},
  {id:'s00033',text:'profitability. Ultimately, not a sector',start_seconds:80.64,end_seconds:85.28},
  {id:'s00034',text:'that I absolutely love beyond Bloom',start_seconds:83.08,end_seconds:86.64},
  {id:'s00035',text:'Energy, which is one of my core',start_seconds:85.28,end_seconds:88.84},
  {id:'s00036',text:'holdings, but the macro tailwind and',start_seconds:86.64,end_seconds:91.08},
  {id:'s00037',text:"Tepper's double-down push me over the",start_seconds:88.84,end_seconds:92.96},
 ];
 const retained={...run,output:{source:{segments:cues},claims:[
  {id:'c1',passed:true,reasons:[],claim:{evidence:[{segment_id:'s00031',end_segment_id:'s00033'},{segment_id:'s00036',end_segment_id:'s00037'}]}},
  {id:'c2',passed:false,reasons:['High conviction unsupported for passive holding.'],claim:{instrument_as_spoken:'Bloom Energy',creator_conviction:'high',evidence:[{segment_id:'s00033',end_segment_id:'s00035'}]}},
 ]}} as unknown as Run;
 const original=JSON.stringify(retained);const windows=actionRecallWindows(retained);
 assert.equal(windows.length,1);assert.ok(windows[0].some(s=>s.id==='s00034'));assert.ok(windows[0].some(s=>s.id==='s00036'));
 assert.equal(JSON.stringify(retained),original,'Candidate selection does not promote or mutate a rejected holding');
});

function rateBrief(quote:string,value=25,unit='percentage_points',text='The central bank raised rates by 25 basis points.',scale='ones',retained=quote) {
 const fact={label:'Rate increase',value,unit,scale,currency:null,period:null,basis:'not_stated',nature:'reported',evidenceId:'c1',quote};
 const evidence=evidenceInventory(run).map(e=>({...e,quotes:e.quotes.map(q=>({...q,text:retained}))}));
 const draft={sentences:[{...sentence,text,financialFacts:[fact]}],mainTopics:['Company'],omissions:[]};
 return {draft, result:validateBrief(draft,evidence,[],analysisContext(run),[{id:'s1',accepted:true,reason:'Faithful source prose.',factualStatus:'unverified'}])};
}
test('exact English and Chinese basis-point quote transparently corrects typed unit without dropping correct prose',()=>{
 for(const quote of ['The Fed raised rates by 25 basis points.','美联储已经加息了25个基点','加息25個基點']) {
  const {draft,result}=rateBrief(quote);assert.equal(result.sentences.length,1);assert.equal(result.sentences[0].financialFacts[0].unit,'basis_points');assert.equal(result.sentences[0].financialFacts[0].value,25);
  assert.equal(result.sentences[0].text,draft.sentences[0].text);assert.equal(draft.sentences[0].financialFacts[0].unit,'percentage_points');
  assert.equal(result.sentences[0].financialFactChecks?.[0].original.unit,'percentage_points');assert.match(result.omissions.join(' '),/unit corrected/i);
 }
});
test('equivalent quarter percentage-point representation remains valid but 100x erroneous prose is not published',()=>{
 const correct=rateBrief('25 basis points',.25);assert.equal(correct.result.sentences[0].financialFacts[0].unit,'percentage_points');assert.equal(correct.result.sentences[0].financialFacts[0].value,.25);
 const wrong=rateBrief('25 basis points',25,'percentage_points','The bank raised rates by 25 percentage points.');assert.equal(wrong.result.sentences.length,0);assert.match(wrong.result.rejected[0].reasons.join(' '),/basis.point/i);
});
test('ambiguous mixed rate quantities and non-unit scale retain unresolved original facts without guessed correction',()=>{
 for(const [quote,scale] of [['25 basis points and 25 percent','ones'],['25 basis points','millions']]) {
  const {result}=rateBrief(quote,25,'percentage_points', 'The source discusses a rate change.',scale);
  assert.equal(result.sentences.length,1);assert.equal(result.sentences[0].financialFacts.length,0);assert.equal(result.sentences[0].financialFactChecks?.[0].status,'unresolved');assert.equal(result.sentences[0].financialFactChecks?.[0].original.value,25);assert.match(result.omissions.join(' '),/withheld/i);
 }
 const unanchored=rateBrief('25 basis points',25,'percentage_points',undefined,undefined,'The source only mentions policy.');assert.equal(unanchored.result.sentences.length,0);
});

test('ordinary share counts normalize from contracts or per-share fields with exact value and scale, never option contracts or prices',async()=>{
 const {reviewFinancialFact,FinancialFact}=await import('../src/features/youtube-intelligence/research-brief.ts');
 const fixtures=[{quote:'CEO James Burke, bought 1.1 million shares across three transactions last week near the 52-week low',value:1100000,scale:'ones',unit:'contracts'},{quote:'I just purchased 100 shares myself, and I am now long the stock',value:100,scale:'ones',unit:'contracts'},{quote:'under which it may offer if applicable sell up to 35 million shares.',value:35,scale:'millions',unit:'per_share',relation:'less_than_or_equal'},{quote:'我持有100股',value:100,scale:'ones',unit:'contracts'}];
 for(const item of fixtures){const fact=FinancialFact.parse({label:'Count',currency:null,period:null,basis:'not_stated',nature:'reported',evidenceId:'c1',...item});const result=reviewFinancialFact(fact,[item.quote]);assert.equal(result.status,'corrected');assert.equal(result.fact?.unit,'shares');assert.equal(result.fact?.value,item.value);assert.equal(fact.unit,item.unit);assert.equal(reviewFinancialFact(fact,[]).status,'unresolved');}
 const base=FinancialFact.parse({label:'Count',value:100,scale:'ones',currency:null,period:null,basis:'not_stated',nature:'reported',evidenceId:'c1',unit:'contracts',quote:'Each option contract represents 100 shares.'});
 assert.equal(reviewFinancialFact(base,[base.quote]).status,'unresolved');
 const price={...base,unit:'per_share' as const,quote:'Price is $100 per share.',currency:'USD'};assert.equal(reviewFinancialFact(price,[price.quote]).status,'unchanged');
 for(const quote of ['100 shares and 200 shares','100 million shares']) assert.equal(reviewFinancialFact({...base,quote},[quote]).status,'unresolved');
});

test('per-barrel correction requires matching anchored currency and preserves unspecified qualifiers',async()=>{
 const {reviewFinancialFact,FinancialFact}=await import('../src/features/youtube-intelligence/research-brief.ts');
 for(const quote of ['布伦特原油仍然是每桶104美元','Brent crude was USD104 per barrel.']) {
  const fact=FinancialFact.parse({label:'Brent price',value:104,unit:'total',scale:'ones',currency:'USD',period:null,basis:'not_stated',nature:'reported',evidenceId:'c1',quote});
  assert.equal(fact.relation,'unknown');assert.equal(fact.unitDescription,null);
  const review=reviewFinancialFact(fact,[quote]);assert.equal(review.fact?.unit,'per_barrel');assert.equal(review.fact?.relation,'unknown');assert.equal(review.fact?.unitDescription,'USD per barrel');
  assert.equal(reviewFinancialFact({...fact,currency:'EUR'},[quote]).status,'unresolved');assert.equal(reviewFinancialFact({...fact,scale:'millions'},[quote]).status,'unresolved');assert.equal(reviewFinancialFact(fact,[]).status,'unresolved');
  const ambiguous={...fact,quote:'Brent crude was $104 per barrel.'};assert.equal(reviewFinancialFact(ambiguous,[ambiguous.quote]).status,'unresolved');
 }
});
test('missing explicit dimension, qualifier and invented peak baseline remain unresolved without guessed semantics',async()=>{
 const {reviewFinancialFact,FinancialFact}=await import('../src/features/youtube-intelligence/research-brief.ts');
 const base=FinancialFact.parse({label:'Value',value:50,unit:'percent',scale:'ones',currency:null,period:null,basis:'not_stated',nature:'reported',evidenceId:'c1',quote:'The shares are down 50% from where they traded two years ago.'});
 assert.equal(reviewFinancialFact({...base,label:'Decline from peak'},[base.quote]).status,'unresolved');
 for(const unit of ['capacity','other'] as const)assert.equal(reviewFinancialFact({...base,unit},[base.quote]).status,'unresolved');
 const approx={...base,quote:'The increase was roughly 50 percent.'};assert.equal(reviewFinancialFact(approx,[approx.quote]).status,'unresolved');assert.equal(reviewFinancialFact({...approx,relation:'approximate'},[approx.quote]).status,'unchanged');
 const words={...base,unit:'percentage_points' as const,value:25,quote:'An increase of twenty-five basis points.'};assert.equal(reviewFinancialFact(words,[words.quote]).status,'unresolved');
});

test('explicit qualifier direction and numerical like approximation cannot be overwritten by any nonunknown label',async()=>{
 const {reviewFinancialFact,FinancialFact}=await import('../src/features/youtube-intelligence/research-brief.ts');
 const base=FinancialFact.parse({label:'Increase',value:50,unit:'percent',scale:'ones',currency:null,period:null,basis:'not_stated',nature:'reported',evidenceId:'c1',quote:'Growth was more than 50 percent.',relation:'less_than'});
 assert.equal(reviewFinancialFact(base,[base.quote]).status,'unresolved');assert.equal(reviewFinancialFact({...base,relation:'greater_than'},[base.quote]).status,'unchanged');
 for(const quote of ['Growth was at least 50 percent.','Growth was 50 percent.'])assert.equal(reviewFinancialFact({...base,quote},[quote]).status,'unresolved');
 const like={...base,value:400,unit:'percentage_points' as const,relation:'unknown' as const,quote:'NPLs have gone up like 400 basis points over the past year.'};assert.equal(reviewFinancialFact(like,[like.quote]).status,'unresolved');
 const precise={...like,relation:'approximate' as const};assert.equal(reviewFinancialFact(precise,[precise.quote]).fact?.unit,'basis_points');
});

test('inclusive issuance ceilings and order floors preserve equality and differ from strict bounds',async()=>{
 const {reviewFinancialFact,FinancialFact}=await import('../src/features/youtube-intelligence/research-brief.ts');
 for(const [quote,relation,wrong] of [['May sell up to 35 million shares.','less_than_or_equal','less_than'],['Orders of at least 35 million shares.','greater_than_or_equal','greater_than'],['No more than 35 million shares.','less_than_or_equal','greater_than'],['No less than 35 million shares.','greater_than_or_equal','less_than']]){
  const fact=FinancialFact.parse({label:'Share bound',value:35,unit:'per_share',scale:'millions',currency:null,period:null,basis:'not_stated',nature:'contract_ceiling',evidenceId:'c1',quote,relation});
  const good=reviewFinancialFact(fact,[quote]);assert.equal(good.fact?.unit,'shares');assert.equal(good.fact?.relation,relation);assert.equal(good.status,'corrected');assert.equal(reviewFinancialFact(FinancialFact.parse({...fact,relation:wrong}),[quote]).status,'unresolved');
 }
});

test('Mandarin percentage-sign approximation stays unresolved until the qualifier matches',async()=>{
 const {reviewFinancialFact,FinancialFact}=await import('../src/features/youtube-intelligence/research-brief.ts');
 const quote='明年的中位数也在4.1%左右';const fact=FinancialFact.parse({label:'Median projection',value:4.1,unit:'percent',scale:'ones',currency:null,period:'next year',basis:'not_stated',nature:'forecast',evidenceId:'c1',quote});
 assert.equal(reviewFinancialFact(fact,[quote]).status,'unresolved');assert.equal(reviewFinancialFact({...fact,relation:'exact'},[quote]).status,'unresolved');assert.equal(reviewFinancialFact({...fact,relation:'approximate'},[quote]).status,'unchanged');
});

test('legacy percent and total fields require exact sentence-scoped provenance before unchanged display',async()=>{
 const {reviewFinancialFact,FinancialFact}=await import('../src/features/youtube-intelligence/research-brief.ts');
 for(const unit of ['percent','total']) {const fact=FinancialFact.parse({label:'Quantity',value:50,unit,scale:'ones',currency:null,period:null,basis:'not_stated',nature:'reported',evidenceId:'c1',quote:'A stated quantity of 50.'});assert.equal(reviewFinancialFact(fact,[]).status,'unresolved');assert.equal(reviewFinancialFact(fact,['Different source']).fact,null);assert.equal(reviewFinancialFact(fact,[fact.quote]).status,'unchanged');}
});
