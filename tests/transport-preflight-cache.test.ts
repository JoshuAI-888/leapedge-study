import test from 'node:test';
import type {GenerateContentResponse} from '@google/genai';
import assert from 'node:assert/strict';
import { OpenRouterTransport } from '../src/server/youtube-intelligence/transport/openrouter.ts';
import { stubFetch, json } from './helpers/fetch-stub.ts';
const catalogue={data:[{id:'anthropic/claude-sonnet-5',context_length:200000,pricing:{prompt:'0.000002',completion:'0.00001'},supported_parameters:['response_format','reasoning'],reasoning:{supported_efforts:['low']}}]};
test('concurrent descriptions share validated metadata; expiry refreshes rates',async()=>{
 let now=0, calls=0;
 const restore=stubFetch([{url: "https://openrouter.ai/api/v1/models",respond:async()=>{calls++;return json(catalogue);}}]);
 try{
  const transport=new OpenRouterTransport({apiKey:'test',now:()=>now});
  const [a,b]=await Promise.all([transport.describe('anthropic/claude-sonnet-5'),transport.describe('anthropic/claude-sonnet-5')]);
  assert.equal(calls,1);assert.equal(a.inputRate,0.000002);assert.equal(b.inputRate,a.inputRate);
  now=59000;await transport.describe('anthropic/claude-sonnet-5');assert.equal(calls,1);
  now=60000;await transport.describe('anthropic/claude-sonnet-5');assert.equal(calls,2);
 }finally{restore.restore();}
});
test('control calls bypass the metadata cache and failures are never cached',async()=>{
 let calls=0;
 const restore=stubFetch([{url: "https://openrouter.ai/api/v1/models",respond:async()=>{calls++;if(calls===1)return json({error:'down'},503);return json(catalogue);}}]);
 try{
  const transport=new OpenRouterTransport({apiKey:'test'});
  await assert.rejects(transport.describe('anthropic/claude-sonnet-5'));
  await transport.describe('anthropic/claude-sonnet-5');
  await transport.describe('anthropic/claude-sonnet-5',{metadataCache:false});
  assert.equal(calls,3);
 }finally{restore.restore();}
});
import { GoogleNativeTransport } from '../src/server/youtube-intelligence/transport/google-native.ts';
import { ModelRequest } from '../src/server/youtube-intelligence/transport/types.ts';
test('token-count reuse requires exact content and media identity',async()=>{
 let calls=0;
 const transport=new GoogleNativeTransport({client:{generateContent:async()=>({candidates:[]} as unknown as GenerateContentResponse),countTokens:async()=>({totalTokens:++calls*100})}});
 const r=ModelRequest.parse({stage:'synthesis',model:'gemini-3.8-flash',user:[{type:'text',text:'source'}],maxOutputTokens:100,temperature:0});
 assert.equal((await transport.countTokens(r)).totalTokens,100);
 assert.equal((await transport.countTokens(r)).totalTokens,100);
 assert.equal((await transport.countTokens({...r,user:[{type:'text',text:'changed'}]})).totalTokens,200);
 assert.equal((await transport.countTokens({...r,video:{type:'video',url:'https://youtube.com/watch?v=abcdefghijk',startSeconds:0,endSeconds:10}})).totalTokens,300);
 assert.equal(calls,3);
});
test('speed routing keeps exact model, strict output parameters and price ceiling',async()=>{
 const transport=new OpenRouterTransport({apiKey:'test'});
 const body=transport.body(ModelRequest.parse({stage:'critique',model:'anthropic/claude-sonnet-5',user:[{type:'text',text:'audit'}],maxOutputTokens:3000,temperature:0,responseSchema:{type:'object'},reasoningEffort:'low',providerRouting:'throughput',providerMaxPrice:{prompt:2,completion:10}}));
 assert.equal(body.model,'anthropic/claude-sonnet-5');
 assert.deepEqual(body.provider,{allow_fallbacks:false,require_parameters:true,sort:'throughput',max_price:{prompt:2,completion:10}});
 assert.deepEqual(body.reasoning,{effort:'low'});assert.equal(body.response_format?.json_schema.strict,true);
});
