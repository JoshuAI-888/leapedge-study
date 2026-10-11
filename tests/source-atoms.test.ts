import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceAtom,sourceAtomIssues,sourceAtomPlan} from '../src/features/youtube-intelligence/source-atoms.ts';
import {Claim} from '../src/features/youtube-intelligence/contracts.ts';
const atom=()=>({version:'source-atom.v1',actorOriginal:'Planet',predicate:'reported',objectOriginal:null,kind:'reported_fact',quantities:[{literal:'13.9 million',unitOriginal:'million',periodOriginal:'Q2',basisOriginal:'adjusted EBITDA'}],conditionsOriginal:[],opposingOriginal:['not net profit']});
test('atomic proposals retain a typed quantity, basis and opposing clause through the claim contract',()=>{
 const proposal=Claim.parse({thesis_en:'Planet reported adjusted EBITDA of 13.9 million, not net profit.',instrument_as_spoken:'Planet',ticker:null,ticker_explicit:false,stance:'neutral',horizon_en:null,conditions_en:[],creator_conviction:'unspecified',risks_en:[],levels:[],source_atom:atom(),evidence:[{segment_id:'a',quote_translation_en:'',quote_original:'Planet Q2 adjusted EBITDA 13.9 million, not net profit.'}]});
 assert.deepEqual(proposal.source_atom,atom());
});
test('unknown actor stays null and no decimal, period or financial basis is reconstructed',()=>{
 const a=SourceAtom.parse({...atom(),actorOriginal:null,opposingOriginal:[],quantities:[{literal:'20905',unitOriginal:null,periodOriginal:null,basisOriginal:null}]});
 assert.deepEqual(sourceAtomIssues({source_atom:a,evidence:[{quote_original:'price 20905'}]}),[]);
 const invented={...a,quantities:[{literal:'209.05',unitOriginal:null,periodOriginal:'Q2',basisOriginal:null}]};
 assert.ok(sourceAtomIssues({source_atom:invented,evidence:[{quote_original:'price 20905'}]}).length>=2);
});
test('source fields require complete literal tokens within a single original range',()=>{
 assert.deepEqual(sourceAtomIssues({source_atom:atom(),evidence:[{quote_original:'Planet Q2 adjusted EBITDA 13.9 million, not net profit.'}]}),[]);
 assert.ok(sourceAtomIssues({source_atom:{...atom(),quantities:[{literal:'33',unitOriginal:null,periodOriginal:null,basisOriginal:null}]},evidence:[{quote_original:'633'}]}).length);
 assert.ok(sourceAtomIssues({source_atom:{...atom(),conditionsOriginal:['if earnings hold']},evidence:[{quote_original:'if earnings'},{quote_original:'hold'}]}).some(r=>r.includes('if earnings hold')));
});
test('missing atomic metadata cannot silently become an eligible atomic context proposal',()=>{
 assert.ok(sourceAtomIssues({evidence:[]},true).length);
 assert.deepEqual(sourceAtomIssues({evidence:[]}),[]);
});
test('historical runs remain opted out and unknown frozen versions fail',()=>{
 assert.equal(sourceAtomPlan({}),null);
 assert.equal(sourceAtomPlan({sourceAtomPlan:{version:'source-atom-plan.v1'}})?.atomisation,true);
 assert.throws(()=>sourceAtomPlan({sourceAtomPlan:{version:'future'}}));
});

test('admission freezes source optimisation independently of provider defaults and previous speed flags',async()=>{
 const {freezeEfficiency}=await import('../src/server/youtube-intelligence/efficiency.ts');
 const {teamDefaults,configHash}=await import('../src/features/youtube-intelligence/settings.ts');
 const team=teamDefaults(), original=structuredClone(team);
 assert.equal(sourceAtomPlan(freezeEfficiency({teamPreferencesSnapshot:team},{})),null);
 team.processing.sourceAtoms=true;
 const frozen=freezeEfficiency({teamPreferencesSnapshot:team},{});
 assert.equal(sourceAtomPlan(frozen)?.compactAudit,true);
 assert.equal(frozen.auditedExecutionPlan,undefined);
 assert.deepEqual(team.models,original.models);
 assert.notEqual(configHash(team),configHash(original));
 team.processing.sourceAtoms=false;
 assert.equal(sourceAtomPlan(frozen)?.version,'source-atom-plan.v1');
});

test('original Chinese actor and unit literals remain supported beside Chinese prose',()=>{
 const a={version:'source-atom.v1',actorOriginal:'帕兰提尔',predicate:'reported EPS',objectOriginal:null,kind:'reported_fact',quantities:[{literal:'33',unitOriginal:'美分',periodOriginal:null,basisOriginal:null}],conditionsOriginal:[],opposingOriginal:[]};
 assert.deepEqual(sourceAtomIssues({source_atom:a,evidence:[{quote_original:'帕兰提尔的每股收益为33美分相比去年。'}]},true),[]);
});

test('an unsupported historical prompt is rejected before atomisation can buy a provider call',async()=>{
 const {step}=await import('../src/server/youtube-intelligence/pipeline.ts');
 await assert.rejects(()=>step({input:{sourceAtomPlan:{version:'source-atom-plan.v1'},promptSnapshot:{pointerEvidence:false}},output:{},stage:'synthesis'} as never),/requires a frozen pointer-evidence prompt; no paid call made/);
});

test('initial and recall deduplication cannot collapse differing atom attribution or conditions',async()=>{
 const {uniqueClaims}=await import('../src/features/youtube-intelligence/chunking.ts');
 const a=Claim.parse({thesis_en:'Planet reports a metric.',instrument_as_spoken:'Planet',ticker:null,ticker_explicit:false,stance:'neutral',horizon_en:null,conditions_en:[],creator_conviction:'unspecified',risks_en:[],levels:[],source_atom:atom(),evidence:[{segment_id:'a',quote_translation_en:'',quote_original:'Planet Q2 adjusted EBITDA 13.9 million, not net profit, if earnings hold.'}]});
 const b={...a,source_atom:{...a.source_atom!,conditionsOriginal:['if earnings hold']}};
 assert.equal(uniqueClaims([a,b]).length,2);
 assert.equal(uniqueClaims([a,structuredClone(a)]).length,1);
});
