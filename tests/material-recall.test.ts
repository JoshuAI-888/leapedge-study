import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase } from './helpers/db.ts';
import { create } from '../src/server/youtube-intelligence/store.ts';
import { prompt } from '../src/server/youtube-intelligence/research-store.ts';
import { step } from '../src/server/youtube-intelligence/pipeline.ts';
import { Source, type CheckedClaim } from '../src/features/youtube-intelligence/contracts.ts';
import { teamDefaults } from '../src/features/youtube-intelligence/settings.ts';
import { FakeModelTransport } from '../src/server/youtube-intelligence/transport/fake.ts';
import { injectTransport } from '../src/server/youtube-intelligence/transport/index.ts';

test('material valuation and moat context is recovered as an unaudited key point, never a fabricated trade', async () => {
 const db = await freshDatabase();
 const fake = new FakeModelTransport({ responses: { 'synthesis-recall-0': { json: {
  claims: [], mentions: [], key_points: [{ thesis_en:'Dutch Bros trades at nineteen times earnings, but low barriers to entry limit its moat; the creator has no position.', instrument_as_spoken:'Dutch Bros', ticker:null, ticker_explicit:false, stance:'neutral', horizon_en:null, conditions_en:[], creator_conviction:'medium', risks_en:['Low barriers to entry.'], levels:[], evidence_ranges:[{start_id:'a',end_id:'a'}] }],
 }, usage:{costUsd:0.001} } } });
 const restore = injectTransport(fake);
 try {
  const settings = teamDefaults();
  const run = await create('material-recall',settings.models.extraction.id,{promptSnapshot:await prompt('evidence-first.web.v8'),teamPreferencesSnapshot:settings},'evidence-first.web.v8');
  run.stage='publish';
  run.output={source:Source.parse({source_kind:'imported_transcript',language:'en',segments:[{id:'a',text:'Dutch Bros trades at nineteen times earnings, but low barriers to entry limit its moat. I have no position.',start_seconds:0,end_seconds:15}]}),claims:[],keyPoints:[],mentions:[]};
  await step(run);
  assert.equal(fake.requestsFor('synthesis-recall-0').length,1);
  assert.match(JSON.stringify(fake.requestsFor('synthesis-recall-0')[0]),/material research key_points and mentions/);
  assert.notEqual(run.status,'completed');
  assert.ok(['translate','critique'].includes(run.stage));
  const points=run.output.keyPoints as CheckedClaim[];
  assert.equal(points.length,1); assert.equal(points[0].passed,false); assert.equal(points[0].claim.stance,'neutral');
  assert.match(points[0].claim.evidence[0].quote_original,/no position/);
  assert.deepEqual(run.output.claims,[]);
 } finally { restore(); await db.close(); }
});

test('a non-call mention-only recall survives and returns to independent critique', async () => {
 const db = await freshDatabase();
 const fake = new FakeModelTransport({responses:{'synthesis-recall-0':{json:{claims:[],key_points:[],mentions:[{instrument_as_spoken:'Dutch Bros',ticker:null,market:'unknown',stance:'watch',sentiment:'neutral',rationale_en:'The creator watches valuation but holds no position.',ranges:[{start_id:'a',end_id:'a'}]}]},usage:{costUsd:0.001}}}});
 const restore=injectTransport(fake);
 try {
  const settings=teamDefaults();const run=await create('mention-recall',settings.models.extraction.id,{promptSnapshot:await prompt('evidence-first.web.v8'),teamPreferencesSnapshot:settings},'evidence-first.web.v8');
  run.stage='publish';run.output={source:Source.parse({language:'en',segments:[{id:'a',text:'Dutch Bros valuation is worth watching, but I have no position.',start_seconds:0,end_seconds:10}]}),claims:[],keyPoints:[],mentions:[]};
  await step(run);
  assert.equal((run.output.mentions as unknown[]).length,1);
  assert.notEqual(run.status,'completed');assert.ok(['translate','critique'].includes(run.stage));
  assert.equal((run.output.mentions as {is_call:boolean}[])[0].is_call,false);
 }finally{restore();await db.close();}
});
