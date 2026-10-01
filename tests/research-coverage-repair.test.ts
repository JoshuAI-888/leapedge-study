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
test('a corrected rejected statement can be audited again without duplicating accepted prose or replacing history',()=>{
 const base={id:'bad',text:'The creator illustrates a 5% bond return.',evidenceIds:['k1'],externalIds:[],kind:'education',horizon:'general',topic:'Valuation',materiality:2,importanceReason:'Discount rate',speaker:'unknown',timeMode:'video_date',calculation:null,financialFacts:[{label:'Scenario yield',value:5,currency:null,unit:'percent',scale:'ones',period:null,basis:'not_stated',nature:'scenario',evidenceId:'k1',quote:'incorrect quote'}]};
 const original=ResearchDraft.parse({sentences:[base],mainTopics:['Valuation'],omissions:[]});const before=structuredClone(original);
 const fixed=ResearchDraft.parse({sentences:[{...base,financialFacts:[{...base.financialFacts[0],quote:'Suppose a bond yields 5%.'}]}],mainTopics:['Valuation'],omissions:[]});
 assert.equal(coverageAdditions(original,fixed,['k1']).sentences.length,0,'Accepted text still deduplicates');
 const repaired=coverageAdditions(original,fixed,['k1'],['bad']);assert.equal(repaired.sentences.length,1);assert.notEqual(repaired.sentences[0].id,'bad');assert.deepEqual(original,before);
 assert.equal(coverageAdditions(original,original,['k1'],['bad']).sentences.length,0,'Unchanged failed content is not a new repair');
});
