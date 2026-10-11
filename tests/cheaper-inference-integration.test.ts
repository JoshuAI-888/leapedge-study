import {test} from "node:test";
import assert from "node:assert/strict";
import {freshDatabase} from "./helpers/db.ts";
import {costFromRetained,reconcileUnknown} from "../src/server/youtube-intelligence/reconcile.ts";
import {reserve,settle,markUnknown,retainResponse,listAttempts} from "../src/server/youtube-intelligence/store.ts";
import {modelCall,modelCallFingerprint} from "../src/server/youtube-intelligence/pipeline.ts";
import {TransportError} from "../src/server/youtube-intelligence/transport/types.ts";
import type {ModelRequestData} from "../src/server/youtube-intelligence/transport/types.ts";
import {injectTransport} from "../src/server/youtube-intelligence/transport/index.ts";
import {teamDefaults} from "../src/features/youtube-intelligence/settings.ts";
import {settings} from "../src/server/youtube-intelligence/actions/settings.ts";

const run = (id:string) => ({id,videoId:"abcdefghijk",url:"https://www.youtube.com/watch?v=abcdefghijk",model:"gemini-3.8-flash",promptVersion:"v1",title:"Fixture",status:"running",stage:"synthesis",createdAt:"",updatedAt:"",error:null,input:{},output:{},cost:0} as Parameters<typeof modelCall>[0]);
test("retained gateway billing overrides token estimates and pending bills do not become charges",()=>{
 assert.equal(costFromRetained({usage:{cost:9},cheaper_inference:{billing:{status:"settled",billed_cost_usd:"0.012",currency:"USD"}}},"gemini-3.8-flash"),0.012);
 assert.equal(costFromRetained({usage:{cost:9},cheaper_inference:{billing:{status:"pending"}}},"gemini-3.8-flash"),null);
});
test("pending gateway bills retain their hold after the reconciliation window",async()=>{
 await freshDatabase(); const id=await reserve("ci-pending","synthesis",0.2);
 await settle(id,null,{transport:"cheaper-inference",model:"gemini-3.8-flash"});await markUnknown(id,"Bill pending");
 await retainResponse(id,"ci-pending","synthesis",{cheaper_inference:{billing:{status:"pending"}},usage:{cost:9}});
 const result=await reconcileUnknown(Date.now()+1000,0);
 assert.deepEqual(result,{checked:1,settled:0,released:0,unresolved:1});
 assert.equal((await listAttempts("ci-pending","synthesis"))[0].status,"unknown");
});
test("gateway output limits cap requests and pricing provenance reaches settled ledger rows",async()=>{
 const db=await freshDatabase();const r=run("ci-limit");let cap=0;
 const restore=injectTransport({name:"cheaper-inference",family:"cheaper-inference",describe:async()=>({contextLength:100000,inputRate:0.000001,audioRate:0,outputRate:0.000002,supportedEfforts:[],maxOutputTokens:100,pricingVersion:"sha256:fixture",pricingCheckedAt:"2026-10-11T00:00:00Z"}),call:async (req:ModelRequestData)=>{cap=req.maxOutputTokens;return{text:'{"ok":true}',usage:{inputTokens:10,outputTokens:5,costUsd:0.012},model:req.model,provider:"Cheaper Inference",finishReason:"stop",raw:{usage:{cost:0.012}}};}});
 try {await modelCall(r,"synthesis",r.model,"P",{a:1},false,{settings:teamDefaults()});
 assert.equal(cap,100);const rows=await db.prepare("SELECT status,amount,metrics FROM yi_calls WHERE run_id=$1").all(r.id);
 assert.equal(rows[0].status,"completed");assert.equal(Number(rows[0].amount),0.012);
 const metrics=typeof rows[0].metrics==="string"?JSON.parse(rows[0].metrics):rows[0].metrics;
 assert.equal(metrics.priceTableVersion,"cheaper-inference:sha256:fixture");assert.equal(metrics.transport,"cheaper-inference");assert.equal(metrics.requestedModel,r.model);
 }finally{restore();}
});
test("gateway billing without vendor metadata still holds unknown costs and reads decimal usage charges",async()=>{
 await freshDatabase();
 for (const [suffix,usage] of [["missing",{}],["decimal",{cost:"0.012"}]] as const) {
  const id=await reserve(`ci-${suffix}`,"synthesis",0.2);
  await settle(id,null,{transport:"cheaper-inference",model:"gemini-3.8-flash"});
  await markUnknown(id,"Bill pending");
  await retainResponse(id,`ci-${suffix}`,"synthesis",{model:"gemini-3.8-flash",usage});
 }
 assert.deepEqual(await reconcileUnknown(Date.now()+1000,0),{checked:2,settled:1,released:0,unresolved:1});
 assert.equal((await listAttempts("ci-missing","synthesis"))[0].status,"unknown");
 const billed=(await listAttempts("ci-decimal","synthesis"))[0];
 assert.equal(billed.status,"completed");assert.equal(billed.amount,0.012);
});
test("saving team settings rejects a correlated critic and incompatible Google model",async()=>{
 const team=teamDefaults();team.models.critique.id="gemini-3.8-flash";
 await assert.rejects(settings.saveTeam.handler(team),/same family/);
 const invalid=teamDefaults();invalid.models.context.transport="google-native";
 await assert.rejects(settings.saveTeam.handler(invalid),/Google requires a Google model/);
});
test("rejected but received gateway responses retain actual billing without another paid attempt",async()=>{
 await freshDatabase();
 for (const costUsd of [0.012,null]) {
  const r=run(`ci-rejected-${costUsd}`);let calls=0;
  const raw={model:"wrong-model",cheaper_inference:{billing:costUsd===null?{status:"pending"}:{status:"settled",billed_cost_usd:String(costUsd),currency:"USD"}}};
  const restore=injectTransport({name:"cheaper-inference",family:"cheaper-inference",describe:async()=>({contextLength:100000,inputRate:0.000001,audioRate:0,outputRate:0.000002,supportedEfforts:[]}),call:async()=>{
   calls++;throw new TransportError("unknown","Provider returned a different model.",undefined,{raw,costUsd});
  }});
  try {
   await assert.rejects(modelCall(r,"synthesis",r.model,"P",{a:1},false,{settings:teamDefaults()}),/different model/);
   const row=(await listAttempts(r.id,"synthesis"))[0];assert.equal(calls,1);
   assert.equal(row.status,costUsd===null?"unknown":"completed");
   if(costUsd!==null){
    assert.equal(row.amount,costUsd);
    await assert.rejects(modelCall(r,"synthesis",r.model,"P",{a:1},false,{settings:teamDefaults()}),/Settled stage has no replayable response/);
    assert.equal(calls,1);
   }
   const result=await reconcileUnknown(Date.now()+1000,0);
   if(costUsd===null)assert.equal(result.unresolved,1);
  }finally{restore();}
 }
});
test("pre-provider-switch frozen runs replay paid responses without introducing the new routing preference",async()=>{
 await freshDatabase();const r=run("legacy-paid");const legacy=teamDefaults();
 legacy.transport.default="google-native";
 legacy.models.extraction.transport="google-native";legacy.models.translation.transport="google-native";
 legacy.models.critique.transport="openrouter";legacy.models.context.transport="openrouter";
 const snapshot=JSON.parse(JSON.stringify(legacy));delete snapshot.transport.cheaperInferenceRanking;
 r.input.teamPreferencesSnapshot=snapshot;
 const fingerprint=modelCallFingerprint({stage:"synthesis",model:r.model,prompt:"P",payload:{a:1},video:null,responseSchema:null,maxOutputTokens:null,inferenceConfig:null,source:null,models:snapshot.models,transport:snapshot.transport});
 const id=await reserve(r.id,"synthesis",0.2);await settle(id,0.012,{model:r.model,requestFingerprint:fingerprint});
 await retainResponse(`${id}:normalized`,r.id,"synthesis",{text:'{"ok":true}',usage:{inputTokens:1,outputTokens:1,costUsd:0.012},model:r.model,provider:"google-native",finishReason:"stop",raw:{},requestFingerprint:fingerprint});
 let calls=0;const restore=injectTransport({name:"google-native",family:"google-native",describe:async()=>{throw Error("A paid response must replay before model description");},call:async()=>{calls++;throw Error("No duplicate paid call");}});
 try{assert.deepEqual(await modelCall(r,"synthesis",r.model,"P",{a:1},false),{ok:true});assert.equal(calls,0);}finally{restore();}
});
