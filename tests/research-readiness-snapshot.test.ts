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
