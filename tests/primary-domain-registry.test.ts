import test from 'node:test';
import assert from 'node:assert/strict';
import { PRIMARY_DOMAINS, PRIMARY_DOMAIN_REGISTRY, isVerifiedPrimaryHost } from '../src/server/youtube-intelligence/primary-domain-registry.ts';
import { freshDatabase } from './helpers/db.ts';
import { stubFetch,json } from './helpers/fetch-stub.ts';
import { create } from '../src/server/youtube-intelligence/store.ts';
import { retrieveResearchSources } from '../src/server/youtube-intelligence/research-sources.ts';

test('ownership registry covers omitted cohort issuers and excludes lookalikes, user content and the wrong Alphabet',()=>{
 assert.ok(PRIMARY_DOMAINS.length<=100);assert.equal(new Set(PRIMARY_DOMAINS).size,PRIMARY_DOMAINS.length);
 for(const host of ['investors.coreweave.com','nebius.com','investor.atmeta.com','openai.com','www.anthropic.com','investors.credosemi.com','investors.dutchbros.com','investor.opendoor.com','nu.com'])assert.equal(isVerifiedPrimaryHost(host),true,host);
 for(const host of ['coreweave.com.evil.test','fake.coreweave.com','notcoreweave.com','community.openai.com','reddit.com','alphabet.com','s205.q4cdn.com','unverified.example'])assert.equal(isVerifiedPrimaryHost(host),false,host);
 assert.equal(isVerifiedPrimaryHost('unverified.example',['unverified.example']),false);
 for(const entry of PRIMARY_DOMAIN_REGISTRY)assert.equal(new URL(entry.ownershipEvidenceUrl).protocol,'https:');
});

test('retrieval searches verified new issuers and does not promote unverified returned subdomains',async()=>{
 const db=await freshDatabase();const prior=process.env.EXA_API_KEY;process.env.EXA_API_KEY='fixture';
 const hosts=['investors.coreweave.com','nebius.com','investor.atmeta.com','openai.com','www.anthropic.com','investors.credosemi.com','investors.dutchbros.com','investor.opendoor.com','fake.coreweave.com','coreweave.com.evil.test','unknown.example'];
 const stub=stubFetch([{url:'https://api.exa.ai/search',respond:()=>json({costDollars:{total:.007},results:hosts.map(host=>({url:`https://${host}/release`,title:'Company announcement',text:'Published on: September 17, 2026\nA retained issuer announcement.',publishedDate:'2026-09-17'}))})}]);
 try{
  const run=await create('registry-test','fixture',{},'fixture');
  const result=await retrieveResearchSources({runId:run.id,query:'AI and cohort issuer research',timeMode:'video_date',cutoff:'2026-09-20T00:00:00Z',primaryDomains:PRIMARY_DOMAINS});
  assert.equal(result.sources.length,hosts.length);
  assert.deepEqual(result.sources.map(s=>s.sourceClass),[...Array(8).fill('primary'),...Array(3).fill('unknown')]);
  const {put,doc}=await import('../src/server/youtube-intelligence/research-store.ts');
  const legacy={...result,sources:result.sources.map(source=>({...source,sourceClass:'primary'}))};
  await put('researchRetrieval',result.key,legacy);
  const replay=await retrieveResearchSources({runId:run.id,query:'AI and cohort issuer research',timeMode:'video_date',cutoff:'2026-09-20T00:00:00Z',primaryDomains:PRIMARY_DOMAINS});
  assert.equal(replay.sources[8].sourceClass,'unknown','same-run replay rechecks old broad host classification without rebuying');
  assert.equal(stub.log.length,1);
  assert.equal((await doc<{sources:{sourceClass:string}[]}>('researchRetrieval',result.key))!.sources[8].sourceClass,'primary','original retained paid record is not rewritten');
  const body=JSON.parse(String(stub.log[0].body));assert.ok(body.includeDomains.includes('coreweave.com'));assert.ok(body.includeDomains.includes('nebius.com'));assert.equal(body.includeDomains.includes('alphabet.com'),false);
 }finally{stub.restore();if(prior===undefined)delete process.env.EXA_API_KEY;else process.env.EXA_API_KEY=prior;await db.close();}
});
