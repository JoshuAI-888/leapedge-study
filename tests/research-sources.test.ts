import { create } from "../src/server/youtube-intelligence/store.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confirmedPublication,
  retrieveResearchSources,
} from "../src/server/youtube-intelligence/research-sources.ts";
import { freshDatabase } from "./helpers/db.ts";
import { stubFetch, json } from "./helpers/fetch-stub.ts";
test("search publication metadata and dates in body text alone never establish historical availability", () => {
  assert.equal(
    confirmedPublication("Reported period September 17, 2026", "2026-09-17"),
    null,
  );
  assert.equal(
    confirmedPublication(
      "Published on: September 17, 2026\nResults",
      "2026-09-17",
    ),
    "2026-09-17T23:59:59.999Z",
  );
  assert.equal(
    confirmedPublication("Published on: September 18, 2026", "2026-09-17"),
    null,
  );
});
test("external retrieval retains responses/cost and never repeats an unknown paid request", async () => {
  const db = await freshDatabase();
  const old = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "fixture";
  const stub = stubFetch([
    {
      url: "https://api.exa.ai/search",
      responses: [
        json({
          costDollars: { total: 0.008 },
          results: [
            {
              url: "https://www.sec.gov/Archives/example",
              title: "Filing",
              text: "Published on: September 17, 2026\nRevenue 10 billion",
              publishedDate: "2026-09-17",
            },
          ],
        }),
        () => {
          throw Error("network outcome unknown");
        },
      ],
    },
  ]);
  try {
    const run = await create("search-fixture", "fixture", {}, "fixture");
    const input = {
      runId: run.id,
      query: "Revenue",
      timeMode: "video_date" as const,
      cutoff: "2026-09-20T00:00:00Z",
      primaryDomains: ["sec.gov"],
    };
    const a = await retrieveResearchSources(input);
    const b = await retrieveResearchSources(input);
    assert.deepEqual(a, b);
    assert.equal(stub.log.length, 1);
    assert.equal(a.costUsd, 0.008);
    assert.equal(a.sources[0].sourceClass, "primary");
    const c = await retrieveResearchSources({ ...input, query: "Other" });
    const d = await retrieveResearchSources({ ...input, query: "Other" });
    assert.equal(c.state, "unknown");
    assert.equal(d.state, "unknown");
    assert.equal(stub.log.length, 2);
    const attempts = await db
      .prepare("SELECT status,amount FROM yi_calls WHERE run_id=$1")
      .all(run.id);
    assert.equal(attempts.length, 2);
    assert.ok(
      attempts.some((a) => a.status === "completed" && a.amount === 0.008),
    );
    assert.ok(attempts.some((a) => a.status === "unknown"));
  } finally {
    stub.restore();
    if (old === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = old;
    await db.close();
  }
});

test("opt-in shared retrieval reuses only fresh matching successful evidence without billing consumers", async (t) => {
  const db = await freshDatabase();
  const old = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = 'fixture';
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-20T00:00:00Z') });
  const stub = stubFetch([{ url: 'https://api.exa.ai/search', responses: Array.from({ length: 12 }, () => json({ costDollars: { total: 0.007 }, results: [{ url: 'https://sec.gov/a', text: 'Published on: September 17, 2026\nRevenue', publishedDate: '2026-09-17' }] })) }]);
  try {
    const input = { query: 'Revenue', timeMode: 'video_date' as const, cutoff: '2026-09-19T00:00:00Z', primaryDomains: ['sec.gov'], reuseCache: true };
    let sequence = 0;
    const retrieve = async (overrides = {}) => {
      const run = await create(`cache-fixture-${sequence++}`, 'fixture', {}, 'fixture');
      return retrieveResearchSources({ ...input, ...overrides, runId: run.id });
    };
    const donor = await retrieve();
    const hit = await retrieve();
    assert.equal(stub.log.length, 1);
    assert.equal(hit.costUsd, 0);
    assert.equal(hit.cache?.donorKey, donor.key);
    assert.equal(hit.cache?.donorCostUsd, 0.007);
    assert.deepEqual(hit.sources, donor.sources);
    assert.equal((await db.prepare('SELECT * FROM yi_calls').all()).length, 1);
    await retrieve({ cutoff: '2026-09-18T00:00:00Z' });
    await retrieve({ primaryDomains: ['other.com'] });
    await retrieve({ query: 'Profit' });
    await retrieve({ timeMode: 'current' });
    assert.equal(stub.log.length, 5);
    t.mock.timers.tick(60 * 60 * 1000 + 1);
    await retrieve({ timeMode: 'current' });
    assert.equal(stub.log.length, 6);
    await retrieve();
    assert.equal(stub.log.length, 6, 'historical cache remains fresh for 24 hours');
    t.mock.timers.tick(24 * 60 * 60 * 1000);
    await retrieve();
    assert.equal(stub.log.length, 7);
    await retrieve({ reuseCache: false });
    assert.equal(stub.log.length, 8, 'disabled feature always performs a fresh cross-run search');
    const { createHash } = await import('node:crypto');
    const { put, doc } = await import('../src/server/youtube-intelligence/research-store.ts');
    const { PRIMARY_DOMAIN_REGISTRY_VERSION } = await import('../src/server/youtube-intelligence/primary-domain-registry.ts');
    const cacheKey = createHash('sha256').update(JSON.stringify({ version: 'exa-retrieval.v2', registryVersion: PRIMARY_DOMAIN_REGISTRY_VERSION, query: input.query, timeMode: input.timeMode, cutoff: input.cutoff, since: null, primaryDomains: input.primaryDomains })).digest('hex');
    await put('researchRetrievalCache', cacheKey, { ...await doc('researchRetrievalCache', cacheKey), version: 'exa-retrieval.v0' });
    await retrieve();
    assert.equal(stub.log.length, 9, 'old cache formats cannot donate evidence');
  } finally {
    t.mock.timers.reset(); stub.restore();
    if (old === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = old;
    await db.close();
  }
});

test("unknown and unpriced responses never become cross-run cache donors", async () => {
  const db = await freshDatabase();
  const old = process.env.EXA_API_KEY; process.env.EXA_API_KEY = 'fixture';
  const stub = stubFetch([{ url: 'https://api.exa.ai/search', responses: [
    () => { throw Error('unknown outcome'); }, json({ results: [] }), json({ costDollars: { total: 0.007 }, results: [] }),
  ] }]);
  try {
    const input = { query: 'Cache unknown', timeMode: 'current' as const, cutoff: '2026-09-20T00:00:00Z', primaryDomains: [], reuseCache: true };
    const a = await create('unknown-cache-a', 'fixture', {}, 'fixture');
    const first = await retrieveResearchSources({ ...input, runId: a.id });
    assert.equal(first.state, 'unknown');
    assert.deepEqual(await retrieveResearchSources({ ...input, reuseCache: false, runId: a.id }), first);
    const b = await create('unknown-cache-b', 'fixture', {}, 'fixture');
    const unpriced = await retrieveResearchSources({ ...input, runId: b.id });
    assert.equal(unpriced.costUsd, null);
    const c = await create('unknown-cache-c', 'fixture', {}, 'fixture');
    assert.equal((await retrieveResearchSources({ ...input, runId: c.id })).costUsd, 0.007);
    assert.equal(stub.log.length, 3);
  } finally {
    stub.restore(); if (old === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = old;
    await db.close();
  }
});

test("cache independently checks donor policy when its pointer targets a different cutoff", async () => {
  const db = await freshDatabase();
  const old = process.env.EXA_API_KEY; process.env.EXA_API_KEY = 'fixture';
  const stub = stubFetch([{ url: 'https://api.exa.ai/search', respond: () => json({ costDollars: { total: 0.007 }, results: [] }) }]);
  try {
    const { createHash } = await import('node:crypto');
    const { put } = await import('../src/server/youtube-intelligence/research-store.ts');
    const input = { query: 'Revenue', timeMode: 'video_date' as const, cutoff: '2026-09-19T00:00:00Z', primaryDomains: ['sec.gov'], reuseCache: true };
    const runA = await create('policy-donor', 'fixture', {}, 'fixture');
    const donor = await retrieveResearchSources({ ...input, runId: runA.id });
    const earlier = { ...input, cutoff: '2026-09-18T00:00:00Z' };
    const cacheKey = createHash('sha256').update(JSON.stringify({ version: 'exa-retrieval.v2', query: earlier.query, timeMode: earlier.timeMode, cutoff: earlier.cutoff, since: null, primaryDomains: earlier.primaryDomains })).digest('hex');
    await put('researchRetrievalCache', cacheKey, { version: 'exa-retrieval.v2', donorKey: donor.key, donorRunId: runA.id });
    const runB = await create('policy-consumer', 'fixture', {}, 'fixture');
    const result = await retrieveResearchSources({ ...earlier, runId: runB.id });
    assert.equal(stub.log.length, 2, 'wrong-cutoff donor must not substitute for a fresh eligible search');
    assert.equal(result.cache, undefined);
  } finally {
    stub.restore(); if (old === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = old;
    await db.close();
  }
});

test("twenty identical eligible searches avoid nineteen provider charges with unchanged source content", async (t) => {
  const db = await freshDatabase();
  const old = process.env.EXA_API_KEY; process.env.EXA_API_KEY = 'fixture';
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-20T00:00:00Z') });
  const stub = stubFetch([{ url: 'https://api.exa.ai/search', respond: () => json({ costDollars: { total: 0.007 }, results: [{ url: 'https://sec.gov/a', title: 'Retained filing', text: 'Published on: September 17, 2026\nRevenue increased 10%.', publishedDate: '2026-09-17' }] }) }]);
  try {
    const summaries = [];
    let reference;
    for (const reuseCache of [false, true]) {
      const start = stub.log.length;
      let cost = 0;
      for (let i = 0; i < 20; i++) {
        const run = await create(`measured-${reuseCache}-${i}`, 'fixture', {}, 'fixture');
        const record = await retrieveResearchSources({ runId: run.id, query: 'Revenue', timeMode: 'video_date', cutoff: '2026-09-19T00:00:00Z', primaryDomains: i % 2 ? ['sec.gov', 'sec.gov'] : ['sec.gov'], reuseCache });
        assert.equal(record.state, 'complete');
        assert.notEqual(record.costUsd, null);
        cost += record.costUsd!;
        // IDs belong to the donor request; all content, hashes, dates and trust
        // metadata supplied to synthesis must remain identical.
        const sourceContent = record.sources.map(({ id: _id, ...source }) => source);
        reference ??= sourceContent;
        assert.deepEqual(sourceContent, reference);
      }
      summaries.push({ reuseCache, calls: stub.log.length - start, costUsd: Number(cost.toFixed(6)) });
    }
    assert.deepEqual(summaries, [{ reuseCache: false, calls: 20, costUsd: 0.14 }, { reuseCache: true, calls: 1, costUsd: 0.007 }]);
    t.diagnostic(JSON.stringify(summaries));
  } finally {
    t.mock.timers.reset(); stub.restore(); if (old === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = old;
    await db.close();
  }
});

test('publication labels support SEC and IR date formats without accepting incidental body dates',()=>{
 for(const text of ['Filing Date\n2026-09-17','Release date: Sept. 17, 2026','Published on 17 September 2026','Published: September 17th, 2026'])
  assert.equal(confirmedPublication(text,'2026-09-17'),'2026-09-17T23:59:59.999Z');
 for(const text of ['Quarter ended September 17, 2026','Our source was published on September 17, 2026','Updated September 17, 2026','Published: September 17, 20260'])
  assert.equal(confirmedPublication(text,'2026-09-17'),null);
});

test('invalid publication calendar dates are never rolled into a different publication date',()=>{
 assert.equal(confirmedPublication('Published: February 30, 2026','2026-03-02'),null);
 assert.equal(confirmedPublication('Filing Date: 2026-02-30','2026-03-02'),null);
});

test('current search interval and primary domains are enforced in requests and cache identities',async()=>{
 const db=await freshDatabase();const old=process.env.EXA_API_KEY;process.env.EXA_API_KEY='fixture';
 const text='Filing Date\n2026-09-20\nRevenue increased.';
 const stub=stubFetch([{url:'https://api.exa.ai/search',respond:()=>json({costDollars:{total:.007},results:[{url:'https://sec.gov/a',text,publishedDate:'2026-09-20'}]})}]);
 try{
  const input={query:'Revenue',timeMode:'current' as const,cutoff:'2026-09-21T00:00:00Z',since:'2026-09-19T00:00:00Z',primaryDomains:['sec.gov'],reuseCache:true};
  const a=await create('since-a','fixture',{},'fixture');const first=await retrieveResearchSources({...input,runId:a.id});
  assert.equal(JSON.parse(stub.log[0].body!).startPublishedDate,input.since);
  assert.deepEqual(JSON.parse(stub.log[0].body!).includeDomains,['sec.gov']);
  assert.equal(first.sources[0].text,text);
  assert.equal(first.sources[0].publicationConfirmed,true);
  const b=await create('since-b','fixture',{},'fixture');await retrieveResearchSources({...input,runId:b.id});assert.equal(stub.log.length,1);
  const c=await create('since-c','fixture',{},'fixture');await retrieveResearchSources({...input,since:'2026-09-20T00:00:00Z',runId:c.id});assert.equal(stub.log.length,2);
  await assert.rejects(retrieveResearchSources({...input,since:input.cutoff,runId:c.id}));
  await assert.rejects(retrieveResearchSources({...input,timeMode:'video_date',runId:c.id}));
 }finally{stub.restore();if(old===undefined)delete process.env.EXA_API_KEY;else process.env.EXA_API_KEY=old;await db.close();}
});
