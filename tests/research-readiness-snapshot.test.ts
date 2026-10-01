import test, {after} from 'node:test';
import {database} from '../src/server/youtube-intelligence/database.ts';
after(async()=>database.close());
import assert from 'node:assert/strict';
import { freshDatabase } from './helpers/db.ts';
import { put } from '../src/server/youtube-intelligence/research-store.ts';
import { dispatch } from '../src/server/youtube-intelligence/actions/index.ts';

test('overview receives readiness without requiring stripped transcript and external payloads', async () => {
 await freshDatabase();
 await put('researchBrief','overview-empty',{id:'overview-empty',sourceRunId:'source',videoId:'video',sentences:[],evidence:[{id:'e1',instrument:'Acme',summary:'Valuation condition',quotes:[{text:'retained private transcript'}]}],external:[],omissions:[],coverageFindings:[],rejected:[],retrievalNotes:[],baseline:[]});
 const snapshot=await dispatch('research','snapshot',undefined) as {researchBriefs:{id:string,readiness?:{status:string,total:number,issues:string[]},evidence?:unknown,external?:unknown}[]};
 const brief=snapshot.researchBriefs.find(b=>b.id==='overview-empty')!;
 assert.equal(brief.readiness?.status,'review_required');
 assert.equal(brief.readiness?.total,1);
 assert.ok(brief.readiness?.issues.some(issue=>issue.includes('No accepted')));
 assert.equal(brief.evidence,undefined);assert.equal(brief.external,undefined);
});

test('research snapshot retains terminal research children and creation timestamps beyond the activity window', async () => {
 const db=await freshDatabase();
 const statuses=['failed','needs_review','completed','queued','running'];
 for(let i=0;i<105;i++) {
  const status=statuses[i%statuses.length];
  await db.prepare('INSERT INTO yi_runs (id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,error,input,output,cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)')
   .run(`history-${i}`,`video-${i}`,'https://youtube.com/watch?v=fixture','fixture','fixture','Fixture',status,'research-audit','2026-09-25T00:00:00.000Z','2026-09-27T00:00:00.000Z',status==='failed'?'Retained audit error':null,JSON.stringify({task:'research-brief',snapshot:{sourceRunId:'source-fixture'}}),'{}',0);
 }
 const snapshot=await dispatch('research','snapshot',undefined) as {jobs:{id:string,status:string,sourceRunId:string,stage:string,error:string|null,createdAt:string,updatedAt:string}[]};
 assert.equal(snapshot.jobs.length,105);
 for(const status of statuses)assert.equal(snapshot.jobs.filter(j=>j.status===status).length,21);
 assert.ok(snapshot.jobs.every(j=>j.sourceRunId==='source-fixture'&&j.createdAt==='2026-09-25T00:00:00.000Z'&&j.updatedAt==='2026-09-27T00:00:00.000Z'));
 assert.ok(snapshot.jobs.filter(j=>j.status==='failed').every(j=>j.error==='Retained audit error'&&j.stage==='research-audit'));
});
