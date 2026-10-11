import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/db.ts';
import {create} from '../src/server/youtube-intelligence/store.ts';
import {enqueueJob} from '../src/server/youtube-intelligence/repos/jobs.ts';
import {claimJob} from '../src/server/youtube-intelligence/queue.ts';
import {checkpointCheckedFindings,renewWorkerLease} from '../src/server/youtube-intelligence/runner.ts';
test('checked findings persist inside a stage without releasing lease, and stale owners cannot overwrite',async()=>{
 const db=await freshDatabase();try{
  const run=await create('findings-checkpoint','fixture',{nonce:crypto.randomUUID()},'v1');
  await enqueueJob({id:`checkpoint:${run.id}`,kind:'analyze',payload:{runId:run.id}});
  const job=(await claimJob())!;const token=job.leaseToken!;
  await db.prepare("UPDATE yi_runs SET status='running',lease_token=$1,lease_until=$2 WHERE id=$3").run(token,Date.now()+600000,run.id);
  run.output.checkedFindingsRevision=1;await checkpointCheckedFindings(run,job.id,token);
  const row=await db.prepare('SELECT output,lease_token,lease_until FROM yi_runs WHERE id=$1').get(run.id);
  assert.equal(JSON.parse(String(row?.output)).checkedFindingsRevision,1);assert.equal(row?.lease_token,token);assert.ok(Number(row?.lease_until)>Date.now());
  await db.prepare("UPDATE jobs SET lease_until='2000-01-01' WHERE id=$1").run(job.id);
  run.output.checkedFindingsRevision=2;await assert.rejects(checkpointCheckedFindings(run,job.id,token),/Stale/);
  assert.equal(JSON.parse(String((await db.prepare('SELECT output FROM yi_runs WHERE id=$1').get(run.id))?.output)).checkedFindingsRevision,1);
 }finally{await db.close();}
});

test('a healthy job can checkpoint long-running findings after the analysis lease deadline',async()=>{
 const db=await freshDatabase();try{
  const run=await create('long-findings-checkpoint','fixture',{nonce:crypto.randomUUID()},'v1');
  const job=(await claimJob())!;const token=job.leaseToken!;
  assert.equal((job.payload as {runId:string}).runId,run.id);
  await db.prepare("UPDATE yi_runs SET status='running',lease_token=$1,lease_until=$2 WHERE id=$3").run(token,Date.now()-1,run.id);
  run.output.checkedFindingsRevision=1;
  await checkpointCheckedFindings(run,job.id,token);
  const row=await db.prepare('SELECT output,lease_token,lease_until FROM yi_runs WHERE id=$1').get(run.id);
  assert.equal(JSON.parse(String(row?.output)).checkedFindingsRevision,1);
  assert.equal(row?.lease_token,token);
  assert.ok(Number(row?.lease_until)>Date.now());
 }finally{await db.close();}
});

test('worker heartbeat renews both leases and cannot renew a replaced analysis owner',async()=>{
 const db=await freshDatabase();try{
  const run=await create('heartbeat-findings','fixture',{nonce:crypto.randomUUID()},'v1');
  const job=(await claimJob())!;const token=job.leaseToken!;
  await db.prepare("UPDATE yi_runs SET status='running',lease_token=$1,lease_until=$2 WHERE id=$3").run(token,Date.now()-1,run.id);
  assert.equal(await renewWorkerLease(job.id,token,run.id),true);
  assert.ok(Number((await db.prepare('SELECT lease_until FROM yi_runs WHERE id=$1').get(run.id))?.lease_until)>Date.now());
  assert.ok(Date.parse(String((await db.prepare('SELECT lease_until FROM jobs WHERE id=$1').get(job.id))?.lease_until))>Date.now());
  await db.prepare("UPDATE jobs SET lease_until='2099-01-01' WHERE id=$1").run(job.id);
  const jobUntil=(await db.prepare('SELECT lease_until FROM jobs WHERE id=$1').get(job.id))?.lease_until;
  await db.prepare("UPDATE yi_runs SET lease_token='replacement' WHERE id=$1").run(run.id);
  await assert.rejects(renewWorkerLease(job.id,token,run.id),/Stale/);
  assert.deepEqual((await db.prepare('SELECT lease_until FROM jobs WHERE id=$1').get(job.id))?.lease_until,jobUntil,'failed paired renewal must roll back its job write');
  run.output.checkedFindingsRevision=99;
  await assert.rejects(checkpointCheckedFindings(run,job.id,token),/Stale/);
  assert.equal(JSON.parse(String((await db.prepare('SELECT output FROM yi_runs WHERE id=$1').get(run.id))?.output)).checkedFindingsRevision,undefined);
 }finally{await db.close();}
});

test('an expired job cannot revive an analysis lease or checkpoint findings',async()=>{
 const db=await freshDatabase();try{
  const run=await create('stale-heartbeat-findings','fixture',{nonce:crypto.randomUUID()},'v1');
  const job=(await claimJob())!;const token=job.leaseToken!;const until=Date.now()+600000;
  await db.prepare("UPDATE yi_runs SET status='running',lease_token=$1,lease_until=$2 WHERE id=$3").run(token,until,run.id);
  await db.prepare("UPDATE jobs SET lease_until='2000-01-01' WHERE id=$1").run(job.id);
  assert.equal(await renewWorkerLease(job.id,token,run.id),false);
  assert.equal(Number((await db.prepare('SELECT lease_until FROM yi_runs WHERE id=$1').get(run.id))?.lease_until),until);
  await assert.rejects(checkpointCheckedFindings(run,job.id,token),/Stale/);
 }finally{await db.close();}
});
