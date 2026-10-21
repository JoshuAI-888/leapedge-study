/** Real, separate-process PostgreSQL reliability check; SDK is injected/keyless.
 * Use a fresh local DB (run migrations first). Never run against production.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { database } from '../src/server/youtube-intelligence/database.ts';
import * as S from '../src/server/youtube-intelligence/store.ts';
import { submitBatchStage, injectBatchClient, batchRecord, pollBatch } from '../src/server/youtube-intelligence/batch.ts';
import { claimJob, completeJob } from '../src/server/youtube-intelligence/queue.ts';
import { processNext } from '../src/server/youtube-intelligence/runner.ts';
import { ModelRequest } from '../src/server/youtube-intelligence/transport/types.ts';
import { createParkedExperimentRun } from './gemini-batch-experiment.ts';
if (process.env.YTI_ISOLATED_DB !== 'true' || process.env.YTI_DB === 'pglite' || !process.env.DATABASE_URL || !['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname))
    throw Error('Fresh isolated local PostgreSQL required.');
const request = ModelRequest.parse({ stage: 'extraction', model: 'gemini-3.8-flash', user: [{ type: 'text', text: 'offline reliability fixture' }], maxOutputTokens: 100, temperature: 0 });
if (process.argv.includes('--child')) {
    injectBatchClient({ create: async () => { console.log('SUBMISSION_ACCEPTED'); return await new Promise(() => { }); }, get: async () => { throw Error('No provider polling expected'); } });
    // Keep process alive in simulated provider IO until parent kills this worker.
    const timer = setInterval(() => { }, 1000);
    await processNext(async (run) => { await submitBatchStage(run, request, 0.02, 1); });
    clearInterval(timer);
}
else {
    const run = await S.create('batch-worker-crash', 'gemini-3.8-flash', { task: 'offline-crash-check', nonce: crypto.randomUUID() }, 'fixture');
    const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url), '--child'], { env: { ...process.env, YTI_QUEUE_PAUSED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(Error('Child did not reach simulated submission: ' + stderr)); }, 15000);
        child.stdout.on('data', chunk => {
            if (chunk.toString().includes('SUBMISSION_ACCEPTED')) {
                clearTimeout(timeout);
                resolve();
            }
        });
        child.on('error', reject);
        child.on('exit', code => {
            if (code !== null && code !== 0)
                reject(Error('Child exited before submission: ' + stderr));
        });
    });
    const died = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await died;
    const record = (await batchRecord(run.id, request.stage))!;
    assert.equal(record.status, 'submitting');
    assert.equal((await S.listAttempts(run.id, request.stage))[0].status, 'reserved');
    const previous = await database.prepare("SELECT lease_token FROM jobs WHERE id=$1").get(`analyze:${run.id}`);
    await database.prepare("UPDATE jobs SET lease_until='2000-01-01' WHERE id=$1").run(`analyze:${run.id}`);
    const reclaimed = (await claimJob())!;
    assert.notEqual(reclaimed.leaseToken, previous!.lease_token);
    assert.equal(reclaimed.id, `analyze:${run.id}`);
    assert.equal(await completeJob(reclaimed.id, String(previous!.lease_token)), false);
    let submissions = 0;
    const restore = injectBatchClient({ create: async () => { submissions++; return { name: 'batches/unexpected' }; }, get: async () => ({ state: 'JOB_STATE_RUNNING' }) });
    try {
        await assert.rejects(() => submitBatchStage(run, request, 0.02, 1), /uncertain/);
        assert.equal(submissions, 0);
        assert.equal((await S.listAttempts(run.id, request.stage)).length, 1);
        assert.equal(await completeJob(reclaimed.id, reclaimed.leaseToken!), true);
        const second = await S.create('batch-concurrent-submit', 'gemini-3.8-flash', { task: 'offline-crash-check', nonce: crypto.randomUUID() }, 'fixture');
        await Promise.allSettled(Array.from({ length: 8 }, () => submitBatchStage(second, request, 0.02, 1)));
        assert.equal(submissions, 1);
        assert.equal((await S.listAttempts(second.id, request.stage)).length, 1);
        const pending = (await batchRecord(second.id, request.stage))!;
        await assert.rejects(() => pollBatch(pending.id), /running/);
        assert.equal((await batchRecord(second.id, request.stage))!.status, 'pending');
        await database.prepare("UPDATE jobs SET status='completed' WHERE id=$1 AND status='queued'").run(`analyze:${second.id}`);
        const parked=await createParkedExperimentRun('parked-local-check','fixture',{task:'gemini-batch-experiment'},'fixture');
        assert.equal(parked.status,'paused');
        assert.equal(await claimJob({kinds:['analyze']}),null);
        console.log('PASS: killed worker after simulated acceptance; lease reclaimed on another process/connection; stale owner fenced; unknown submission not repeated; eight concurrent submissions create one paid intent; pending job preserved. SDK mocked, no model spend.');
        console.log('PASS: manually driven experiment run and automatic analysis exclusion commit atomically in real PostgreSQL.');
    }
    finally {
        restore();
        await database.close();
    }
}
