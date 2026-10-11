import test from "node:test";
import assert from "node:assert/strict";
import { acceptsReadingUpdate } from "../src/features/youtube-intelligence/analyst-reading.ts";

test("same-stage revisions advance without a stale poll downgrading checked findings",()=>{
 const current={runId:"video-a",revision:5,final:false};
 assert.equal(acceptsReadingUpdate(current,{...current,revision:4}),false);
 assert.equal(acceptsReadingUpdate(current,{...current,revision:6}),true);
 assert.equal(acceptsReadingUpdate(current,{...current,revision:5}),true);
});
test("final publication replaces provisional findings and survives older in-progress responses",()=>{
 const prior={runId:"video-a",revision:6,final:false};
 assert.equal(acceptsReadingUpdate(prior,{...prior,revision:0,final:true}),true);
 assert.equal(acceptsReadingUpdate({...prior,final:true},{...prior,revision:7}),false);
 assert.equal(acceptsReadingUpdate({...prior,final:true},{runId:"video-b",revision:0,final:false}),true);
});
test("malformed or negative revisions fail closed instead of poisoning the reading clock",()=>{
 for(const revision of [-1,NaN,1.5,"7"]) assert.throws(()=>acceptsReadingUpdate(null,{runId:"a",final:false,revision:revision as number}));
});
