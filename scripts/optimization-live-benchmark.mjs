/** Bounded live benchmark. Uses an isolated in-memory database; never the production queue. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
// Explicit --live required; credentials come from Node --env-file or the environment.
const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    input: { type: 'string' },
    output: { type: 'string' },
    revision: { type: 'string' },
    variant: { type: 'string' },
    live: { type: 'boolean', default: false },
  },
});
if (
  !values.live || !values.root || !values.input || !values.output ||
  !values.revision || !['before', 'after'].includes(values.variant)
)
  throw Error('Required: --live --root checkout --input retained-export.json --output result.json --revision SHA --variant before|after');
const variant = values.variant;
const file = resolve(values.output);
// Exclusive creation prevents both overwriting evidence and concurrent reuse of
// one destination. A failed attempt leaves this diagnostic rather than inviting
// a silent repeat of potentially paid work.
try {
  writeFileSync(file, JSON.stringify({ state: 'initializing', paidWorkStarted: false }), {
    flag: 'wx', mode: 0o600,
  });
} catch (error) {
  if (error?.code === 'EEXIST') throw Error('Refusing to overwrite an existing benchmark export.');
  throw error;
}
const root = resolve(values.root);
function verifyRevision() {
  let actual = null, source = null, dirty = null;
  if (existsSync(resolve(root, '.git'))) {
    const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (head.status === 0) {
      actual = head.stdout.trim();
      source = 'git HEAD';
      const status = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
      dirty = status.status === 0 ? !!status.stdout.trim() : null;
    }
  }
  if (!actual) {
    for (const name of ['installed-revision.txt', 'CODE_REVISION']) {
      const marker = resolve(root, name);
      if (existsSync(marker)) {
        actual = readFileSync(marker, 'utf8').trim();
        source = name;
        break;
      }
    }
  }
  if (!actual) return { verified: false, source: null, actual: null, dirty: null, reason: 'No git HEAD or installed revision marker available.' };
  const matches = /^[a-f0-9]{7,40}$/i.test(values.revision) &&
    /^[a-f0-9]{7,40}$/i.test(actual) &&
    (actual.toLowerCase().startsWith(values.revision.toLowerCase()) ||
      values.revision.toLowerCase().startsWith(actual.toLowerCase()));
  if (!matches) throw Error(`Supplied revision does not match ${source}: ${actual}`);
  return { verified: dirty !== true, source, actual, dirty,
    reason: source === 'git HEAD' ? 'HEAD label checked; dirty working trees are not verified.' : 'Installed revision marker checked; installed file contents are not independently hashed.' };
}
const revisionVerification = verifyRevision();
Object.assign(process.env, {
  YTI_DB: 'pglite',
  YTI_QUEUE_PAUSED: 'true',
  YTI_EMAIL_SEND_ENABLED: 'false',
});
delete process.env.DATABASE_URL;
delete process.env.DATABASE_URL_UNPOOLED;
const load = p => import(pathToFileURL(root + '/' + p));
const { database } = await load('src/server/youtube-intelligence/database.ts');
const S = await load('src/server/youtube-intelligence/store.ts');
const R = await load('src/server/youtube-intelligence/research-store.ts');
const { step } = await load('src/server/youtube-intelligence/pipeline.ts');
const { ensureResearchBrief } = await load('src/server/youtube-intelligence/research-pipeline.ts');
const retained = JSON.parse(readFileSync(resolve(values.input)));
if (
  !Array.isArray(retained.runs) ||
  retained.runs.filter(r => !r.input.task).length > 20 ||
  !retained.runs.some(r => !r.input.task)
)
  throw Error('Requires one to twenty frozen source analyses');
const settings = structuredClone(retained.runs.find(r => !r.input.task).input.teamPreferencesSnapshot);
settings.processing.parallelVideos = 1;
await R.saveTeamPreferences(settings);
const output = {
  benchmark: {
    revision: values.revision,
    revisionVerification,
    controls: {
      concurrency: 1,
      settings,
      sourceCohort: createHash('sha256')
        .update(readFileSync(resolve(values.input)))
        .digest('hex'),
      start: 'synthesis',
      asOf: 'frozen original createdAt',
      search: 'live uncached per run; retrieval content may vary between trials',
      speculativeResearch: false,
      reuseResearchCache: false,
      baselineHistory: 'empty frozen baseline for every research brief',
    },
  },
  manifest: [],
  runs: [],
  calls: [],
  timings: [],
  briefs: [],
};
async function save() {
  output.calls = await database.prepare('SELECT * FROM yi_calls').all();
  output.runs = await S.list();
  output.briefs = await R.docs('researchBrief');
  writeFileSync(file, JSON.stringify(output, null, 2), { mode: 0o600 });
}
async function execute(run) {
  let count = 0;
  run.status = 'running';
  while (run.status === 'running' && count++ < 80) {
    const stage = run.stage, start = performance.now();
    try {
      await step(run, settings);
    }
    catch (e) {
      run.status = 'failed';
      run.error = e.message;
    }
    const execution_ms = performance.now() - start;
    const checkpoint = performance.now();
    await database.prepare(
      'UPDATE yi_runs SET stage=$1,status=$2,output=$3,title=$4,error=$5,updated_at=$6 WHERE id=$7',
    ).run(
      run.stage, run.status, JSON.stringify(run.output), run.title,
      run.error ?? null, new Date().toISOString(), run.id,
    );
    output.timings.push({
      run_id: run.id, stage, execution_ms, queue_ms: 0,
      checkpoint_ms: performance.now() - checkpoint,
    });
    await save();
    console.log(JSON.stringify({
      variant, videoId: run.videoId, stage, seconds: execution_ms / 1000,
      status: run.status, error: run.error,
    }));
  }
  if (run.status !== 'completed')
    throw Error(run.error ?? 'stage limit');
  return await S.get(run.id);
}
try {
  for (const old of retained.runs.filter(r => !r.input.task)) {
    const input = {
      ...old.input,
      teamPreferencesSnapshot: settings,
      efficiencyVersion: variant === 'after' ? 'evidence-efficiency.v1' : undefined,
      speculativeResearch: false,
      reuseResearchCache: false,
    };
    for (const k of ['recoveryOf', 'recoveryBatch', 'productionSample'])
      delete input[k];
    const run = await S.create(old.videoId, old.model, input, old.promptVersion);
    output.manifest.push({
      videoId: old.videoId, runId: run.id,
      queuedAt: run.createdAt, resumedStage: 'synthesis',
    });
    run.stage = 'synthesis';
    run.createdAt = old.createdAt;
    run.title = old.title;
    run.output = {
      source: old.output.source, metadata: old.output.metadata,
      sourceHash: old.output.sourceHash, coverage: old.output.coverage,
    };
    await database.prepare('UPDATE yi_runs SET created_at=$1 WHERE id=$2')
      .run(old.createdAt, run.id);
    const done = await execute(run);
    const brief = await ensureResearchBrief(done);
    if (brief) {
      brief.output.researchBaseline = [];
      await execute(brief);
    }
  }
}
finally {
  await save();
  await database.close();
}
