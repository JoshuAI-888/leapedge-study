import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materializeSelectedClaim } from '../src/features/youtube-intelligence/evidence-selection.ts';
import { validateClaim } from '../src/features/youtube-intelligence/contracts.ts';
const source={source_kind:'test',segments:[{id:'a',text:'If SPY breaks below 500, exit. Do not wait for a close.',start_seconds:1,end_seconds:5},{id:'b',text:'QQQ is only a watch, not a buy.',start_seconds:6,end_seconds:8}]};
const c={thesis_en:'Exit on a break below 500.',instrument_as_spoken:'SPY',ticker:'SPY',ticker_explicit:true,stance:'conditional',horizon_en:null,conditions_en:['break below 500'],creator_conviction:'unspecified',risks_en:[],levels:[{kind:'stop',value_original:'500'}],evidence_segment_ids:['a']};
test('source selection copies exact evidence and rejects invented IDs/duplicates',()=>{
 const claim=materializeSelectedClaim(c,source);
 assert.equal(claim.evidence[0].quote_original,source.segments[0].text);
 assert.equal(claim.evidence[0].quote_translation_en,'');
 assert.deepEqual(validateClaim(claim,source),[]);
 assert.throws(()=>materializeSelectedClaim({...c,evidence_segment_ids:['missing']},source));
 assert.throws(()=>materializeSelectedClaim({...c,evidence_segment_ids:['a','a']},source));
});
test('source selection cannot validate a price or ticker from an unrelated cue',()=>{
 const claim=materializeSelectedClaim({...c,evidence_segment_ids:['b']},source);
 assert.ok(validateClaim(claim,source).includes('Price is not present verbatim in its evidence.'));
 assert.ok(validateClaim(claim,source).includes('Ticker is not explicit in its evidence.'));
});
