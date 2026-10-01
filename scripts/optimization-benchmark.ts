/** Offline paired comparison. No provider calls. Missing experimental controls invalidate gains.
 * Add benchmark: { controls: { concurrency, ...all unchanged model/source/cache/as-of settings },
 * revision: "git SHA" } to each export. Treatment switches belong outside controls.
 * Run: node --experimental-strip-types scripts/optimization-benchmark.ts --before old.json --after new.json
 * Output never certifies semantic correctness: source-backed review remains required.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const number = z.number().finite().nonnegative();
const object = z.record(z.string(), z.unknown());
const exportSchema = z.object({
  benchmark: z.object({ controls: object, revision: z.string().min(1) }).optional(),
  manifest: z.array(z.object({ videoId: z.string(), runId: z.string(), queuedAt: z.string(), resumedStage: z.string().optional() })),
  runs: z.array(z.object({ id: z.string(), videoId: z.string(), status: z.string(), updatedAt: z.string(), model: z.string().optional(), input: object.optional(), output: object.nullish() })),
  calls: z.array(z.object({ run_id: z.string(), stage: z.string(), status: z.string(), amount: number, metrics: z.union([z.string(), object]).nullable() })),
  timings: z.array(z.object({ run_id: z.string(), stage: z.string(), execution_ms: number, queue_ms: number, checkpoint_ms: number })),
  briefs: z.array(z.object({ sourceRunId: z.string(), runId: z.string(), videoId: z.string(), createdAt: z.string(),
    sentences: z.array(z.object({ id: z.string(), text: z.string(), evidenceIds: z.array(z.string()), externalIds: z.array(z.string()), factualStatus: z.string() })),
    evidence: z.array(z.object({ id: z.string() })), external: z.array(z.object({ id: z.string() })),
    omissions: z.array(z.unknown()), coverageFindings: z.array(z.unknown()), externalCostUsd: number.optional(), unknownExternalCosts: number.optional(),
  })),
});
type Export = z.infer<typeof exportSchema>;
const metricsSchema = z.object({ tokens: z.object({ inputTokens: number.optional(), outputTokens: number.optional() }).optional(), usage: z.object({ prompt_tokens: number.optional(), completion_tokens: number.optional() }).optional() });
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  if (value && typeof value === 'object') return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return JSON.stringify(value);
}
function elapsed(start: string, end?: string): number | null {
  if (!end) return null;
  const value = (Date.parse(end) - Date.parse(start)) / 1000;
  return Number.isFinite(value) && value >= 0 ? value : null;
}
const regressionChecklist = [
  { videoId: 'M1FJ5dNiBEs', check: 'Credo preference under the 170s at 7:43–7:52: retain condition, attribution and exact source span.' },
  { videoId: 'ZfOQoh82JTo', check: 'Dutch Bros moat concerns appear in the important-information summary, with source spans; full long-video coverage retained.' },
  { videoId: '1WNowIoNgtg', check: 'Retain put-selling direction, November 20 expiry and contract terms; flag contradictory source numbers rather than silently repair.' },
];
function measure(data: Export, videoId: string) {
  const item = data.manifest.find(m => m.videoId === videoId)!;
  const run = data.runs.find(r => r.id === item.runId);
  const brief = data.briefs.find(b => b.sourceRunId === item.runId);
  const briefRun = data.runs.find(r => r.id === brief?.runId);
  const ids = new Set([item.runId, ...(brief ? [brief.runId] : [])]);
  const calls = data.calls.filter(c => ids.has(c.run_id));
  const callStages: Record<string, { costUsd: number; inputTokens: number; outputTokens: number; calls: number }> = {};
  for (const call of calls) {
    const stage = callStages[call.stage] ??= { costUsd: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
    stage.costUsd += call.amount; stage.calls++;
  }
  let inputTokens = 0, outputTokens = 0, missingTokenCalls = 0;
  for (const call of calls.filter(c => !c.stage.startsWith('external-search'))) {
    const m = metricsSchema.parse(typeof call.metrics === 'string' ? JSON.parse(call.metrics) : call.metrics ?? {});
    const input = m.tokens?.inputTokens ?? m.usage?.prompt_tokens;
    const output = m.tokens?.outputTokens ?? m.usage?.completion_tokens;
    if (input === undefined || output === undefined) missingTokenCalls++;
    inputTokens += input ?? 0; outputTokens += output ?? 0;
    callStages[call.stage].inputTokens += input ?? 0; callStages[call.stage].outputTokens += output ?? 0;
  }
  const stages: Record<string, { executionSeconds: number; queueSeconds: number; checkpointSeconds: number }> = {};
  for (const t of data.timings.filter(t => ids.has(t.run_id))) {
    const s = stages[t.stage] ??= { executionSeconds: 0, queueSeconds: 0, checkpointSeconds: 0 };
    s.executionSeconds += t.execution_ms / 1000; s.queueSeconds += t.queue_ms / 1000; s.checkpointSeconds += t.checkpoint_ms / 1000;
  }
  const evidence = new Set(brief?.evidence.map(e => e.id));
  const external = new Set(brief?.external.map(e => e.id));
  const brokenCitations: string[] = [];
  for (const s of brief?.sentences ?? []) {
    for (const id of s.evidenceIds) if (!evidence.has(id)) brokenCitations.push(`${s.id}: missing evidence ${id}`);
    for (const id of s.externalIds) if (!external.has(id)) brokenCitations.push(`${s.id}: missing external ${id}`);
    if (!s.evidenceIds.length && !s.externalIds.length) brokenCitations.push(`${s.id}: no references`);
  }
  const modelCostUsd = calls.filter(c => !c.stage.startsWith('external-search')).reduce((sum, c) => sum + c.amount, 0);
  const searchCalls = calls.filter(c => c.stage.startsWith('external-search'));
  const searchCostUsd = searchCalls.length ? searchCalls.reduce((sum, c) => sum + c.amount, 0) : brief?.externalCostUsd ?? 0;
  return {
    sourceBytesHash: run?.output?.source === undefined ? null : createHash('sha256').update(canonical(run.output.source)).digest('hex'),
    resolvedConfigHash: run?.model && run.input ? canonical({ model: run.model, teamPreferences: run.input.teamPreferencesSnapshot, inference: run.input.inferenceConfig, critic: run.input.criticModel, transcription: run.input.transcriptionModel, processingMode: run.input.processingMode }) : null,
    sourceHash: typeof run?.output?.sourceHash === 'string' ? run.output.sourceHash : null,
    resumedStage: item.resumedStage ?? 'fresh', complete: run?.status === 'completed' && !!brief && briefRun?.status === 'completed',
    analysisSeconds: elapsed(item.queuedAt, run?.updatedAt), finalBriefSeconds: elapsed(item.queuedAt, briefRun?.updatedAt),
    costUsd: modelCostUsd + searchCostUsd, modelCostUsd, searchCostUsd,
    unknownExternalCosts: brief?.unknownExternalCosts ?? null,
    inputTokens, outputTokens, missingTokenCalls, callStages, unsettledCalls: calls.filter(c => c.status !== 'completed').length, stages,
    quality: { acceptedSentences: brief?.sentences.length ?? 0, externallyVerified: brief?.sentences.filter(s => s.factualStatus === 'corroborated').length ?? 0,
      brokenCitations, omissions: brief?.omissions ?? [], coverageFindings: brief?.coverageFindings ?? [],
      reviewRequired: ['Company/topic coverage', 'Numeric accuracy and option terms', 'Citation semantic support and exact transcript spans', 'Video-date/current-update separation', ...regressionChecklist.filter(c => c.videoId === videoId).map(c => c.check)] },
  };
}
export function compareExports(beforeInput: unknown, afterInput: unknown) {
  const before = exportSchema.parse(beforeInput), after = exportSchema.parse(afterInput);
  const invalidReasons: string[] = [];
  if (!before.benchmark || !after.benchmark) invalidReasons.push('Missing frozen benchmark controls/revision metadata.');
  else {
    if (canonical(before.benchmark.controls) !== canonical(after.benchmark.controls)) invalidReasons.push('Experimental controls differ.');
    for (const [label, data] of [['before', before], ['after', after]] as const) {
      if (!Number.isInteger(data.benchmark!.controls.concurrency) || Number(data.benchmark!.controls.concurrency) < 1) invalidReasons.push(`${label}: missing positive integer concurrency control.`);
    }
  }
  const a = before.manifest.map(m => m.videoId), b = after.manifest.map(m => m.videoId);
  if (!a.length || canonical([...a].sort()) !== canonical([...b].sort()) || new Set(a).size !== a.length || new Set(b).size !== b.length) invalidReasons.push('Cohorts differ, are empty, or contain duplicate videos.');
  const videos = a.filter(id => b.includes(id)).map(videoId => {
    const old = measure(before, videoId), current = measure(after, videoId);
    if (!old.sourceHash || old.sourceHash !== current.sourceHash) invalidReasons.push(`${videoId}: source hashes absent or different.`);
    if (!old.sourceBytesHash || old.sourceBytesHash !== current.sourceBytesHash) invalidReasons.push(`${videoId}: frozen source bytes absent or different.`);
    if (!old.resolvedConfigHash || old.resolvedConfigHash !== current.resolvedConfigHash) invalidReasons.push(`${videoId}: recorded run model/config absent or different.`);
    if (old.resumedStage !== current.resumedStage) invalidReasons.push(`${videoId}: different ingestion/recovery start.`);
    if (!old.complete || !current.complete || old.finalBriefSeconds === null || current.finalBriefSeconds === null) invalidReasons.push(`${videoId}: incomplete run/brief or invalid timestamps.`);
    if (old.unsettledCalls || current.unsettledCalls) invalidReasons.push(`${videoId}: unsettled/failed ledger entries require cost reconciliation.`);
    return { videoId, before: old, after: current };
  });
  const comparable = invalidReasons.length === 0;
  return { version: 'optimization-benchmark.v1', comparable, invalidReasons,
    qualityVerdict: videos.some(v => v.after.quality.brokenCitations.length || !v.after.complete) ? 'failed' : 'review-required',
    caveats: ['Stage sums can overlap and are not wall-clock duration.', 'Counts and valid reference IDs do not establish factual accuracy or semantic support.', 'No quality approval without source-backed review of the listed checks.', 'Costs are ledger amounts plus external search; caption credits and unknown provider costs are not converted into dollars.'],
    videos: videos.map(v => ({ ...v, improvement: comparable ? {
      finalBriefSeconds: v.before.finalBriefSeconds! - v.after.finalBriefSeconds!, costUsd: v.before.costUsd - v.after.costUsd,
      inputTokens: v.before.inputTokens - v.after.inputTokens, outputTokens: v.before.outputTokens - v.after.outputTokens,
    } : null })),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = (flag: string) => { const index = process.argv.indexOf(flag); if (index < 0 || !process.argv[index + 1]) throw new Error(`Required ${flag} <export.json>`); return process.argv[index + 1]; };
  const result = compareExports(JSON.parse(readFileSync(path('--before'), 'utf8')), JSON.parse(readFileSync(path('--after'), 'utf8')));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.comparable || result.qualityVerdict === 'failed') process.exitCode = 1;
}
