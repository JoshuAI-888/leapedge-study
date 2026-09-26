import test from 'node:test';
import assert from 'node:assert/strict';
import {GoogleNativeTransport} from '../src/server/youtube-intelligence/transport/google-native.ts';
import {ModelRequest} from '../src/server/youtube-intelligence/transport/types.ts';
import {sourceRecallResponseSchema} from '../src/server/youtube-intelligence/schemas/source-recall.ts';
import {RecallReconciliation} from '../src/features/youtube-intelligence/source-recall.ts';
import {stubFetch,json} from './helpers/fetch-stub.ts';

test('real Google SDK serializes combined recall schema without nested JSON-schema dialect metadata',async()=>{
 const original=JSON.stringify(sourceRecallResponseSchema);
 const stub=stubFetch([{url:'generativelanguage.googleapis.com',respond:()=>json({candidates:[{content:{parts:[{text:'{"claims":[],"key_points":[],"mentions":[]}'}],role:'model'},finishReason:'STOP'}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2},modelVersion:'gemini-3.8-flash'})}]);
 try{
 const response=await new GoogleNativeTransport({apiKey:'fixture-not-real'}).call(ModelRequest.parse({stage:'synthesis-recall-0',model:'gemini-3.8-flash',user:[{type:'text',text:'Fixture'}],responseSchema:sourceRecallResponseSchema,maxOutputTokens:12000,temperature:0}));
 assert.equal(response.finishReason,'stop');assert.equal(stub.log.length,1);
 const body=JSON.parse(stub.log[0].body!);const schema=body.generationConfig.responseSchema;
 assert.ok(schema,'Manual extraction shape should use native responseSchema wire field');assert.equal(body.generationConfig.responseJsonSchema,undefined);
 assert.doesNotMatch(JSON.stringify(schema),/"\$schema"/);assert.doesNotMatch(JSON.stringify(schema),/"maxItems"/);
 assert.ok(schema.required.includes('reconciliation'));assert.ok(schema.properties.reconciliation.required.includes('propositions'));
 assert.ok(schema.properties.reconciliation.properties.propositions.items.required.includes('candidateRefs'));
 assert.ok(schema.properties.reconciliation.properties.propositions.items.required.includes('exclusionBasis'));
 assert.equal(schema.properties.key_points.items.properties.levels,undefined,'Context contract does not offer trade level roles');
 assert.ok(schema.properties.claims.items.properties.levels,'Actual creator claims retain supported trade roles');
 assert.equal(JSON.stringify(sourceRecallResponseSchema),original,'Transport must not mutate shared strict/local schema');
 assert.equal(RecallReconciliation.safeParse({reviewedSourceIds:Array(201).fill('x'),propositions:[],limitations:[]}).success,false,'Local cardinality constraints still enforce the strict model contract');
 }finally{stub.restore();}
});
