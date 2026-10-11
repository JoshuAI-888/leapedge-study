import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeEfficiency } from '../src/server/youtube-intelligence/efficiency.ts';
import { auditedExecution } from '../src/features/youtube-intelligence/audited-execution.ts';
import { teamDefaults,configHash } from '../src/features/youtube-intelligence/settings.ts';
test('admission freezes audited plan; historical input remains historical',()=>{
 const team=teamDefaults();const old={teamPreferencesSnapshot:team};
 assert.equal(auditedExecution(freezeEfficiency(old,{})),null);
 team.processing.auditedSpeed=true;
 const next=freezeEfficiency({teamPreferencesSnapshot:team},{});
 assert.equal(auditedExecution(next)?.version,'audited-speed.v1');
 assert.equal(next.publicationSafeguardsVersion,'atomic-publication.v1');
 assert.notEqual(configHash(team),configHash(teamDefaults()));
 team.processing.auditedSpeed=false;
 assert.equal(auditedExecution(next)?.recallOverlap,true);
});
