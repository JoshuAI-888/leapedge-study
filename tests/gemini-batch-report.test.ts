import test from 'node:test';
import assert from 'node:assert/strict';
import { economics } from '../scripts/gemini-batch-report.ts';
test('all-in break even includes ineligible spend and extra infrastructure', () => {
    assert.deepEqual(economics(.2, .08, .01), { eligibleSpendFraction: .4, grossSavingUsd: .04, netSavingUsd: .03, netSavingFraction: .15, meetsProposedGate: true });
    assert.equal(economics(.2, .04, .01).meetsProposedGate, false);
    assert.throws(() => economics(.1, .2, 0));
});
test('historical eligible spend distinguishes root text from research children and foreign critics', async () => {
    const { eligibleSpend } = await import('../scripts/gemini-batch-report.ts');
    const result = eligibleSpend([
        { run_id: 'root', stage: 'synthesis', status: 'completed', amount: .1, metrics: { transport: 'google-native' } },
        { run_id: 'child', stage: 'synthesis-research', status: 'completed', amount: .2, metrics: { transport: 'google-native' } },
        { run_id: 'root', stage: 'critique', status: 'completed', amount: .3, metrics: { transport: 'openrouter' } },
    ], [{ id: 'root', input: {} }, { id: 'child', input: { task: 'research-brief' } }]);
    assert.equal(result.currentRootEligibleUsd, .1);
    assert.equal(result.allNativeTextEligibleUsd, .3);
    assert.equal(result.totalRecordedUsd, .6);
});
test('paired cost claims require identical source, prompt, schema, payload and requested model', async () => {
    const { pairedCosts } = await import('../scripts/gemini-batch-report.ts');
    const base = { videoId: 'fixture', kind: 'text', sourceHash: 's', promptHash: 'p', schemaHash: 'j', payloadHash: 'd', requestedModel: 'gemini-3.8-flash' };
    assert.equal(pairedCosts([{ ...base, mode: 'immediate', recordedTokenPriceCostUsd: .02 }, { ...base, mode: 'batch', recordedTokenPriceCostUsd: .01 }])[0].savingFraction, .5);
    assert.throws(() => pairedCosts([{ ...base, mode: 'immediate', recordedTokenPriceCostUsd: .02 }, { ...base, sourceHash: 'changed', mode: 'batch', recordedTokenPriceCostUsd: .01 }]));
});

test('exported campaign economics include independent-audit costs and unresolved audit holds',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'gemini-report-'));
 try{
  const identity={videoId:'fixture',kind:'text',mode:'immediate',sourceHash:'s',promptHash:'p',schemaHash:'j',payloadHash:'d',requestedModel:'gemini-3.8-flash'};
  writeFileSync(join(dir,'arm.summary.json'),JSON.stringify({...identity,version:'gemini-batch-arm.v1',runId:'r',state:'received',createdAt:'2026-10-21T00:00:00Z',updatedAt:'2026-10-21T00:00:01Z',attempts:[{id:'c',status:'completed',amount:.02,metrics:{}}]}));
  writeFileSync(join(dir,'audit-done.json'),JSON.stringify({version:'gemini-batch-audit.v1',state:'completed',videoId:'fixture',attempts:[{id:'a',status:'completed',amount:.03,metrics:{}}]}));
  writeFileSync(join(dir,'audit-held.json'),JSON.stringify({version:'gemini-batch-audit.v1',state:'stopped',videoId:'fixture',attempts:[{id:'b',status:'unknown',amount:.04,metrics:{}}]}));
  execFileSync(process.execPath,['--experimental-strip-types','scripts/gemini-batch-report.ts','--input',dir,'--output',join(dir,'report.json')]);
  const result=JSON.parse(readFileSync(join(dir,'report.json'),'utf8'));
  assert.equal(result.recordedTokenPriceCostUsd,.05);assert.equal(result.unresolvedHoldUsd,.04);assert.equal(result.quality.liveIndependentAudits,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
