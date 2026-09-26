import test from 'node:test';
import assert from 'node:assert/strict';
import { assertResumeIdentity, ledgerAccounting, benchmarkDatabaseName } from '../scripts/run-cohort-durable.mjs';
test('resuming refuses any implementation, source or settings change',()=>{
 const identity={implementationSha256:'a',inputSha256:'b',settingsSha256:'c'};
 assert.doesNotThrow(()=>assertResumeIdentity(identity,{...identity}));
 for(const field of Object.keys(identity))assert.throws(()=>assertResumeIdentity(identity,{...identity,[field]:'changed'}),/identity/);
});
test('ledger costs separate external calls and unknown holds without doubling donors',()=>{
 const result=ledgerAccounting([{id:'a',run_id:'r',stage:'critique',status:'completed',amount:.2},{id:'b',run_id:'r',stage:'external-search-key',status:'completed',amount:.007},{id:'c',run_id:'r',stage:'critique',status:'unknown',amount:.1}]);
 assert.equal(result.settledModelUsd,.2);assert.equal(result.settledExternalUsd,.007);assert.equal(result.settledLedgerUsd,.20700000000000002);assert.equal(result.openHolds.length,1);
});
test('benchmark cannot name a production or remote database',()=>{
 assert.equal(benchmarkDatabaseName('test_a'),'yti_perf_readiness_test_a');
 assert.throws(()=>benchmarkDatabaseName('prod;DROP DATABASE'),/identifier/);
 assert.throws(()=>benchmarkDatabaseName('../yti_live'),/identifier/);
});
