import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchDraft } from '../src/features/youtube-intelligence/research-brief.ts';
import { coverageAdditions } from '../src/server/youtube-intelligence/research-coverage-repair.ts';

test('supplemental IDs avoid original IDs without rewriting or removing original statements',()=>{
 const sentence={id:'coverage-1',text:'Original holding.',evidenceIds:['c1'],externalIds:[],kind:'holding',horizon:'fundamental',topic:'Company',materiality:2,importanceReason:'Holding',speaker:'unknown',timeMode:'video_date',calculation:null};
 const original=ResearchDraft.parse({sentences:[sentence,{...sentence,id:'coverage-3',text:'Original countercase.'}],mainTopics:['Company'],omissions:[]});
 const snapshot=structuredClone(original);
 const supplement=ResearchDraft.parse({sentences:[{...sentence,id:'duplicate',text:'New condition.',evidenceIds:['c2']},{...sentence,id:'coverage-1',text:'New valuation.',evidenceIds:['c2']}],mainTopics:['Company'],omissions:[]});
 const result=coverageAdditions(original,supplement,['c2']);
 assert.deepEqual(result.sentences.map(s=>s.id),['coverage-2','coverage-4']);
 assert.deepEqual(original,snapshot);
 assert.equal(new Set([...original.sentences,...result.sentences].map(s=>s.id)).size,4);
});
