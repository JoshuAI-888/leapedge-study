/** Paired frozen-source stage experiment. Does not measure ingestion-to-display. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
const record = z.record(z.string(), z.unknown());
const n = z.number().finite().nonnegative();
const schema = z.object({ variant: z.string(), scope: z.string(), concurrency: z.number().int().positive(),
  timings: z.array(z.object({ videoId: z.string(), stage: z.enum(['translate', 'research-audit']), seconds: n, sourceHash: z.string().min(1), error: z.string().nullable() })),
  runs: z.array(z.object({ id: z.string(), videoId: z.string(), model: z.string(), promptVersion: z.string(), input: record, output: record })),
  calls: z.array(z.object({ run_id: z.string(), status: z.string(), amount: n, metrics: z.union([z.string(), record]).nullable() })),
});
const verdictSchema = z.object({ id: z.string(), accepted: z.boolean(), reason: z.string(), factualStatus: z.string() }).passthrough();
const auditSchema = z.object({ verdicts: z.array(verdictSchema) }).passthrough();
const tokenSchema = z.object({ tokens: z.object({ inputTokens: n, outputTokens: n }).optional() });
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  if (value && typeof value === 'object') return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
  return JSON.stringify(value);
}
function hash(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function snapshots(input: unknown) {
  const data = schema.parse(input);
  if (data.runs.length !== data.timings.length) throw Error('Each timing must have a matching ordered run.');
  const sourceHashes = new Map(data.runs.filter(r => r.output.source !== undefined).map(r => [r.videoId, createHash('sha256').update(JSON.stringify(r.output.source)).digest('hex')]));
  return { concurrency: data.concurrency, entries: data.timings.map((t, index) => {
    const run = data.runs[index];
    if (run.videoId !== t.videoId || (t.stage === 'research-audit') !== (run.input.task === 'research-brief')) throw Error('Timing/run pairing mismatch.');
    const calls = data.calls.filter(c => c.run_id === run.id);
    const tokens = calls.map(c => tokenSchema.parse(typeof c.metrics === 'string' ? JSON.parse(c.metrics) : c.metrics ?? {}).tokens);
    const controlInput = { ...run.input }; delete controlInput.efficiencyVersion;
    const audit = t.stage === 'research-audit' ? auditSchema.parse(run.output.researchAudit) : null;
    return { videoId: t.videoId, stage: t.stage, sourceHash: t.sourceHash, recomputedSourceHash: sourceHashes.get(t.videoId) ?? null, retrievalHash: hash(run.output.retrievals ?? null), seconds: t.seconds, error: t.error,
      controlHash: hash({ model: run.model, promptVersion: run.promptVersion, input: controlInput }),
      draftHash: t.stage === 'research-audit' ? hash(run.output.researchDraft) : null,
      costUsd: calls.reduce((sum, c) => sum + c.amount, 0), inputTokens: tokens.reduce((sum, t) => sum + (t?.inputTokens ?? 0), 0), outputTokens: tokens.reduce((sum, t) => sum + (t?.outputTokens ?? 0), 0),
      missingTokenCalls: tokens.filter(t => !t).length, unsettledCalls: calls.filter(c => c.status !== 'completed').length,
      auditPayloadMetrics: run.output.auditPayloadMetrics === undefined ? null : z.object({ originalBytes: n, actualBytes: n, evidenceItems: n, sentences: n, policy: z.string() }).parse(run.output.auditPayloadMetrics),
      verdicts: audit?.verdicts ?? [], coverageFindings: audit?.coverageFindings ?? [],
    };
  }) };
}
export function compareStages(beforeInput: unknown, afterInput: unknown) {
  const before = snapshots(beforeInput), after = snapshots(afterInput), invalidReasons: string[] = [];
  if (before.concurrency !== after.concurrency) invalidReasons.push('Concurrency differs.');
  const key = (e: { videoId: string; stage: string }) => `${e.videoId}/${e.stage}`;
  const beforeKeys = before.entries.map(key), afterKeys = after.entries.map(key);
  if (!beforeKeys.length || canonical([...beforeKeys].sort()) !== canonical([...afterKeys].sort()) || new Set(beforeKeys).size !== beforeKeys.length || new Set(afterKeys).size !== afterKeys.length) invalidReasons.push('Stage cohorts incomplete or duplicated.');
  const pairs = before.entries.flatMap(b => {
    const a = after.entries.find(e => key(e) === key(b)); if (!a) return [];
    if (a.sourceHash !== b.sourceHash || !a.recomputedSourceHash || !b.recomputedSourceHash || a.recomputedSourceHash !== a.sourceHash || b.recomputedSourceHash !== b.sourceHash || a.retrievalHash !== b.retrievalHash || a.controlHash !== b.controlHash || a.draftHash !== b.draftHash) invalidReasons.push(`${key(b)}: frozen source, draft, retrieval or control mismatch (or missing source bytes).`);
    if (a.error || b.error || a.unsettledCalls || b.unsettledCalls) invalidReasons.push(`${key(b)}: errors or unsettled calls.`);
    const ids = new Set([...a.verdicts, ...b.verdicts].map(v => v.id));
    const verdictChanges = [...ids].flatMap(id => {
      const bv = b.verdicts.find(v => v.id === id) ?? null, av = a.verdicts.find(v => v.id === id) ?? null;
      if (canonical(bv) === canonical(av)) return [];
      return [{ id, classificationChanged: !bv || !av || bv.accepted !== av.accepted || bv.factualStatus !== av.factualStatus, before: bv, after: av }];
    });
    return [{ videoId: b.videoId, stage: b.stage, before: b, after: a, verdictChanges }];
  });
  const comparable = invalidReasons.length === 0;
  return { version: 'optimization-stage-report.v1', scope: 'Frozen translation and final research audit only; not ingestion-to-display.', comparable, invalidReasons,
    qualityVerdict: 'review-required', caveat: 'One paired trial per stage; provider variability remains. Changed verdicts require source-backed adjudication; unchanged verdicts are not accuracy proof. Extraction/audit recall, queueing and UI paint are not measured.',
    rows: pairs.map(p => ({ ...p, savedSeconds: comparable ? p.before.seconds - p.after.seconds : null, savedUsd: comparable ? p.before.costUsd - p.after.costUsd : null })) };
}
export function stageMarkdown(report: ReturnType<typeof compareStages>): string {
  const f = (n: number) => n.toFixed(3);
  const lines = ['# Frozen-stage optimisation experiment', '', report.scope, '', `Comparable: **${report.comparable}**. Quality: **${report.qualityVerdict}**.`, '', report.caveat, '',
    '| Video | Stage | Before sec | After sec | Saved sec | Before USD | After USD | Before input/output tokens | After input/output tokens |', '|---|---|---:|---:|---:|---:|---:|---:|---:|'];
  for (const r of report.rows) lines.push(`| ${r.videoId} | ${r.stage} | ${f(r.before.seconds)} | ${f(r.after.seconds)} | ${r.savedSeconds === null ? 'invalid' : f(r.savedSeconds)} | ${r.before.costUsd.toFixed(6)} | ${r.after.costUsd.toFixed(6)} | ${r.before.inputTokens}/${r.before.outputTokens} | ${r.after.inputTokens}/${r.after.outputTokens} |`);
  const sum = (side: 'before' | 'after', field: 'seconds' | 'costUsd') => report.rows.reduce((total, r) => total + r[side][field], 0);
  lines.push('', `Measured sequential stage work: ${f(sum('before', 'seconds'))} → ${f(sum('after', 'seconds'))} seconds. Measured stage API spend: $${sum('before', 'costUsd').toFixed(6)} → $${sum('after', 'costUsd').toFixed(6)}. These sums are not end-to-end latency.`, '');
  if (report.invalidReasons.length) lines.push('', 'Invalid comparisons:', ...report.invalidReasons.map(r => `- ${r}`));
  for (const r of report.rows.filter(r => r.stage === 'research-audit')) {
    lines.push('', `## ${r.videoId}: audit verdict differences`, '', `Frozen source: \`${r.before.sourceHash}\`. Frozen draft: \`${r.before.draftHash}\`.`, '');
    if (r.after.auditPayloadMetrics) { const p = r.after.auditPayloadMetrics; lines.push(`Audit payload bytes: ${p.originalBytes} original → ${p.actualBytes} actual; ${p.evidenceItems} video evidence items and ${p.sentences} sentences. Policy: ${p.policy}.`, ''); }
    for (const v of r.verdictChanges) lines.push(`- **${v.id}** (${v.classificationChanged ? 'classification changed' : 'reason/assessment changed'}): before ${v.before?.accepted ?? 'missing'} / ${v.before?.factualStatus ?? 'missing'} — ${v.before?.reason ?? 'missing'} After ${v.after?.accepted ?? 'missing'} / ${v.after?.factualStatus ?? 'missing'} — ${v.after?.reason ?? 'missing'}`);
    if (!r.verdictChanges.length) lines.push('No verdict differences.');
  }
  return `${lines.join('\n')}\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const before = arg('--before'), after = arg('--after'); if (!before || !after) throw Error('Required --before <export.json> --after <export.json> [--markdown <report.md>]');
  const report = compareStages(JSON.parse(readFileSync(before, 'utf8')), JSON.parse(readFileSync(after, 'utf8')));
  const markdown = arg('--markdown'); if (markdown) writeFileSync(markdown, stageMarkdown(report));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.comparable) process.exitCode = 1;
}
