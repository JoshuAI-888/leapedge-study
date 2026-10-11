import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {Source,deriveEvidence,type Run,type CheckedClaim} from '../src/features/youtube-intelligence/contracts.ts';
import * as analyst from '../src/server/youtube-intelligence/analyst-view.ts';
import {freshDatabase} from './helpers/db.ts';
import {database} from '../src/server/youtube-intelligence/database.ts';
import {create} from '../src/server/youtube-intelligence/store.ts';
after(async()=>database.close());

const source=Source.parse({source_kind:'captions',segments:[
 {id:'s1',text:'I am watching Acme if demand holds. Competition is a risk.',start_seconds:12,end_seconds:20},
 {id:'s2',text:'The business driver is recurring demand. Debt is a risk if margins fall.',start_seconds:30,end_seconds:40},
 {id:'s3',text:'ComputeCo benefits from demand.',start_seconds:52,end_seconds:60},
]});
function checked(id:string,text:string,segment:string):CheckedClaim {
 const original=deriveEvidence(source,{start_id:segment,end_id:segment});
 return {id,passed:true,reasons:[],audit:{verdict:'accept',reason_en:'Independent source review'},claim:{thesis_en:text,instrument_as_spoken:'Acme',ticker:null,ticker_explicit:false,stance:'watch',action:'watch',owner:'creator',horizon_en:null,conditions_en:[],risks_en:[],creator_conviction:'medium',levels:[],evidence:[{segment_id:segment,quote_original:original.quote_original,quote_translation_en:original.quote_original,source_span:{start_id:segment,end_id:segment,start_seconds:original.start_seconds,end_seconds:original.end_seconds,text_hash:original.text_hash}}]}};
}
function fixture():Run {
 const claim=checked('c1','I am watching Acme if demand holds.','s1');
 claim.claim.conditions_en=['if demand holds'];claim.claim.risks_en=['Competition is a risk.'];
 const point=checked('k1','The business driver is recurring demand.','s2');
 point.claim.risks_en=['Debt is a risk if margins fall.'];
 const pending=checked('pending','PENDING_SENTINEL','s1');delete pending.audit;
 const rejected=checked('rejected','REJECTED_SENTINEL','s2');rejected.audit!.verdict='reject';
 const q=deriveEvidence(source,{start_id:'s3',end_id:'s3'});
 return {id:'r',videoId:'video',url:'https://youtube.com/watch?v=video',model:'fixture',promptVersion:'fixture',title:'Acme research',status:'running',stage:'critique',createdAt:'2026-10-12T00:00:00Z',updatedAt:'2026-10-12T00:00:00Z',error:null,cost:0,input:{auditedExecutionPlan:{version:'audited-speed.v1',checkedFindings:true}},output:{checkedFindingsRevision:1,checkedFindingsPublicationState:'coverage_in_progress',source,claims:[claim,pending],keyPoints:[point,rejected],mentions:[{instrument_as_spoken:'ComputeCo',ticker:null,market:'unknown',stance:'watch',sentiment:'bullish',rationale_en:'ComputeCo benefits from demand.',is_call:false,claim_id:null,source_span:{start_id:'s3',end_id:'s3',start_seconds:q.start_seconds,end_seconds:q.end_seconds,text_hash:q.text_hash}}],mentionChecks:{'ComputeCo:s3:s3':true}}};
}
function project(run:Run) {
 // Namespace lookup makes the first red run exercise the missing implementation.
 const fn=(analyst as unknown as {checkedFindingsFor:(run:Run)=>unknown}).checkedFindingsFor;
 assert.equal(typeof fn,'function');
 return fn(run) as {revision:number;view:{publicationState:string;summary:{text:string}[];sections:{points:{text:string;references:{at:number|null;text:string}[]}[]}[]};note:string}|null;
}
test('provisional publication contains independently accepted root context, every condition and exact ranges only',()=>{
 const run=fixture(),before=structuredClone(run),result=project(run)!;
 assert.equal(result.revision,1);assert.equal(result.view.publicationState,'coverage_in_progress');
 assert.match(result.note,/watching Acme/);assert.match(result.note,/recurring demand/);
 assert.match(result.note,/if demand holds/);assert.match(result.note,/Competition is a risk/);
 assert.match(result.note,/Debt is a risk if margins fall/);assert.match(result.note,/ComputeCo benefits/);
 assert.doesNotMatch(JSON.stringify(result),/PENDING_SENTINEL|REJECTED_SENTINEL/);
 assert.deepEqual(result.view.summary.map(s=>s.text),['I am watching Acme if demand holds.','The business driver is recurring demand.','Competition is a risk.']);
 assert.ok(result.view.sections.flatMap(s=>s.points).every(p=>p.references.length>0));
 assert.deepEqual(run,before,'publication never mutates retained audit or source');
});
test('frozen opt-in and positive bounded integer revision are required',()=>{
 for(const plan of [undefined,{version:'audited-speed.v1',checkedFindings:false},{version:'audited-speed.v1'},{version:'other',checkedFindings:true}]){
  const run=fixture();run.input.auditedExecutionPlan=plan;assert.equal(project(run),null);
 }
 for(const revision of [undefined,0,-1,1.2,'1',1e10]){const run=fixture();run.output.checkedFindingsRevision=revision;assert.equal(project(run),null);}
 const child=fixture();child.input.task='research-brief';assert.equal(project(child),null);
});
test('changed original pointer/hash/quote/time fails closed without hiding intact accepted context',()=>{
 const run=fixture();const claim=(run.output.claims as CheckedClaim[])[0];
 claim.claim.evidence[0].source_span!.text_hash='a'.repeat(64);
 let result=project(run)!;assert.doesNotMatch(result.note,/watching Acme/);assert.match(result.note,/recurring demand/);
 (run.output.keyPoints as CheckedClaim[])[0].claim.evidence[0].quote_original='ALTERED_QUOTE';
 (run.output.mentions as {source_span:{start_seconds:number}}[])[0].source_span.start_seconds=53;
 assert.equal(project(run),null);
});
test('all accepted material remains visible and separate ranges never invent a single summary timestamp',()=>{
 const run=fixture(),claim=(run.output.claims as CheckedClaim[])[0];
 claim.claim.conditions_en=Array(8).fill('if demand holds');
 claim.claim.evidence.push(structuredClone((run.output.keyPoints as CheckedClaim[])[0].claim.evidence[0]));
 const result=project(run)!;
 assert.equal(result.view.sections[0].points.filter(p=>p.text==='if demand holds').length,8);
 const overview=result.view.summary[0] as {at?:number|null;references?:{at:number|null}[]};
 assert.equal(overview.at,null);assert.deepEqual(overview.references?.map(r=>r.at),[12,30]);
 assert.equal((result.note.match(/if demand holds/g)??[]).length>=8,true);
});
test('legacy accepted labels cannot bypass the caption-decimal safeguard',()=>{
 const run=fixture(),retained=structuredClone(source);retained.segments[0].text+=' Acme EPS is 147.';
 run.output.source=retained;
 const claim=(run.output.claims as CheckedClaim[])[0];claim.claim.thesis_en='Acme EPS is 1.47.';
 const original=deriveEvidence(retained,{start_id:'s1',end_id:'s1'});
 claim.claim.evidence[0].quote_original=original.quote_original;
 claim.claim.evidence[0].source_span!.text_hash=original.text_hash;
 assert.doesNotMatch(project(run)!.note,/1\.47/);
});
test('run detail exposes same-stage checked findings while preserving full processing output and access guard',async()=>{
 const db=await freshDatabase(),run=fixture();const stored=await create('checked-detail','fixture',run.input,'fixture');
 await db.prepare("UPDATE yi_runs SET status='running',stage='critique',output=$1 WHERE id=$2").run(JSON.stringify(run.output),stored.id);
 const {GET}=await import('../src/app/api/intelligence/runs/[id]/route.ts');
 const response=await GET(new Request(`http://localhost/api/intelligence/runs/${stored.id}`),{params:Promise.resolve({id:stored.id})});
 assert.equal(response.status,200);const detail=await response.json();
 assert.equal(detail.checkedFindings.revision,1);assert.match(detail.checkedFindings.note,/recurring demand/);
 assert.equal(detail.findingsRevision,1);
 assert.doesNotMatch(JSON.stringify(detail.checkedFindings),/PENDING_SENTINEL|REJECTED_SENTINEL/);
 assert.deepEqual(detail.run.output.source,source);assert.equal(detail.run.output.claims.length,2);
 assert.equal((await GET(new Request('https://untrusted.example/api/intelligence/runs/r'),{params:Promise.resolve({id:stored.id})})).status,400);
 await db.prepare("UPDATE yi_runs SET status='completed',output=$1 WHERE id=$2").run(JSON.stringify({...run.output,checkedFindingsRevision:2,source:null}),stored.id);
 const withdrawn=await (await GET(new Request(`http://localhost/api/intelligence/runs/${stored.id}`),{params:Promise.resolve({id:stored.id})})).json();
 assert.equal(withdrawn.findingsRevision,2);assert.equal(withdrawn.checkedFindings,null);
 assert.equal(withdrawn.analystView,null,'no fallback root publication can restore withdrawn checked findings');
});
test('accepted child publication wins even before the root status catches up and cannot restore rejected root text',async()=>{
 const db=await freshDatabase(),run=fixture(),stored=await create('child-priority','fixture',run.input,'fixture');
 await db.prepare("UPDATE yi_runs SET status='running',stage='publish',output=$1 WHERE id=$2").run(JSON.stringify(run.output),stored.id);
 const {put}=await import('../src/server/youtube-intelligence/research-store.ts');
 await put('researchBrief','brief',{id:'brief',runId:'child',sourceRunId:stored.id,mainTopics:['Acme'],omissions:[],evidence:[{id:'c1',quotes:[{startId:'s1',endId:'s1',text:source.segments[0].text}]}],sentences:[{id:'accepted-child',text:'CHILD_ACCEPTED: Acme remains a watch.',evidenceIds:['c1'],externalIds:[],financialFacts:[],kind:'creator_view',horizon:'general',topic:'Acme',materiality:3,importanceReason:'Main assessment',speaker:'creator',timeMode:'video_date'}],rejected:[{text:'CHILD_REJECTED_SENTINEL'}]});
 const {GET}=await import('../src/app/api/intelligence/runs/[id]/route.ts');
 const detail=await (await GET(new Request(`http://localhost/api/intelligence/runs/${stored.id}`),{params:Promise.resolve({id:stored.id})})).json();
 assert.equal(detail.checkedFindings,null);assert.equal(detail.analystView.publicationState,'reviewed_brief');
 assert.match(detail.analystNote,/CHILD_ACCEPTED/);
 assert.doesNotMatch(JSON.stringify({view:detail.analystView,note:detail.analystNote}),/PENDING_SENTINEL|REJECTED_SENTINEL|recurring demand|ComputeCo/);
 assert.deepEqual(detail.run.output.source,source);
});
