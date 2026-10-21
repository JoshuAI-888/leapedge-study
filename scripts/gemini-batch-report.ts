/** Keyless exporter: sanitized manifests -> JSON/CSV, with measured vs modeled costs separate. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { digest } from './gemini-batch-experiment.ts';
import { units, editCounts } from '../src/features/youtube-intelligence/agreement.ts';
import { Source } from '../src/features/youtube-intelligence/contracts.ts';
const round = (n: number) => Number(n.toFixed(10));
export function economics(totalUsd: number, eligibleUsd: number, extraUsd: number) {
    for (const n of [totalUsd, eligibleUsd, extraUsd])
        z.number().finite().nonnegative().parse(n);
    if (totalUsd <= 0 || eligibleUsd > totalUsd)
        throw Error('Invalid eligible spend or total');
    const gross = eligibleUsd * .5, net = gross - extraUsd;
    return { eligibleSpendFraction: round(eligibleUsd / totalUsd), grossSavingUsd: round(gross), netSavingUsd: round(net), netSavingFraction: round(net / totalUsd), meetsProposedGate: net / totalUsd >= .15 - 1e-12 };
}
const Attempt = z.looseObject({ id: z.string(), status: z.string(), amount: z.number(), metrics: z.record(z.string(), z.unknown()) });
export function eligibleSpend(callsRaw: unknown, runsRaw: unknown) {
    const calls = z.array(z.object({ run_id: z.string(), stage: z.string(), status: z.string(), amount: z.number().nonnegative(), metrics: z.record(z.string(), z.unknown()) })).parse(callsRaw);
    const runs = z.array(z.looseObject({ id: z.string(), input: z.unknown() })).parse(runsRaw);
    const groups: Record<string, number> = {};
    for (const call of calls) {
        if (call.status === 'released')
            continue;
        const run = runs.find(r => r.id === call.run_id);
        if (!run)
            throw Error('Historical call has no root/child identity');
        const input = z.record(z.string(), z.unknown()).parse(typeof run.input === 'string' ? JSON.parse(run.input) : run.input);
        const native = call.metrics.transport === 'google-native';
        const group = native ? /^transcribe|^native|audio/.test(call.stage) ? 'nativeMedia' : input.task === 'research-brief' ? 'nativeChildText' : 'nativeRootText' : String(call.metrics.transport ?? 'other');
        groups[group] = round((groups[group] ?? 0) + call.amount);
    }
    const total = round(Object.values(groups).reduce((a, b) => a + b, 0));
    return { totalRecordedUsd: total, groups, currentRootEligibleUsd: groups.nativeRootText ?? 0, allNativeTextEligibleUsd: round((groups.nativeRootText ?? 0) + (groups.nativeChildText ?? 0)), kind: 'historical token-ledger attribution; potential discount, not measured Batch or all-in saving' };
}
const Arm = z.looseObject({ version: z.literal('gemini-batch-arm.v1'), runId: z.string(), kind: z.string(), mode: z.string(), videoId: z.string(), state: z.string(), createdAt: z.string(), updatedAt: z.string(), attempts: z.array(Attempt) });
export function pairedCosts(raw: unknown) {
    const rows = z.array(z.looseObject({ videoId: z.string(), kind: z.string(), mode: z.string(), sourceHash: z.string(), promptHash: z.string(), schemaHash: z.string(), payloadHash: z.string(), requestedModel: z.string(), recordedTokenPriceCostUsd: z.number().nullable() })).parse(raw).filter(r => r.kind === 'text');
    return [...new Set(rows.map(r => r.videoId))].flatMap(videoId => {
        const sync = rows.find(r => r.videoId === videoId && r.mode === 'immediate'), batch = rows.find(r => r.videoId === videoId && r.mode === 'batch');
        if (!sync || !batch || sync.recordedTokenPriceCostUsd === null || batch.recordedTokenPriceCostUsd === null)
            return [];
        for (const key of ['sourceHash', 'promptHash', 'schemaHash', 'payloadHash', 'requestedModel'] as const)
            if (sync[key] !== batch[key])
                throw Error('Incomparable paired ' + key);
        return [{ videoId, synchronousUsd: sync.recordedTokenPriceCostUsd, batchUsd: batch.recordedTokenPriceCostUsd, savingFraction: round(1 - batch.recordedTokenPriceCostUsd / sync.recordedTokenPriceCostUsd), scope: 'same-input extraction stage only; cache/output variation remains; no all-in or research-quality claim' }];
    });
}
function main() {
    const { values: v } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' }, corpus: { type: 'string' }, 'historical-calls': { type: 'string' }, 'historical-runs': { type: 'string' } } });
    if (!v.input || !v.output)
        throw Error('--input private-evidence-directory --output report.json required');
    const arms = readdirSync(v.input).filter(p => p.endsWith('.summary.json')).map(p => Arm.parse(JSON.parse(readFileSync(join(v.input!, p), 'utf8'))));
    const rows = arms.map(a => ({ runId: a.runId, videoId: a.videoId, kind: a.kind, mode: a.mode, status: a.state, sourceHash: a.sourceHash, promptVersion: a.promptVersion, promptHash: a.promptHash, payloadHash: a.payloadHash, schemaHash: a.schemaHash, requestFingerprint: (a.batch as {
            requestFingerprint?: string;
        } | null)?.requestFingerprint ?? a.attempts[0]?.metrics.requestFingerprint, requestedModel: a.requestedModel, sdk: a.sdk, providerJob: (a.batch as {
            name?: string;
        } | null)?.name ?? null, createdAt: a.createdAt, lastObservedAt: a.updatedAt, submissionOrCallMs: a.submissionOrCallMs ?? null, elapsedToLastObservationMs: Date.parse(a.updatedAt) - Date.parse(a.createdAt), firstResultObservedAt: a.firstResultObservedAt ?? null, timeToRawResultObservedMs: typeof a.firstResultObservedAt === 'string' ? Date.parse(a.firstResultObservedAt) - Date.parse(a.createdAt) : null, providerQueueMs: null, providerProcessingMs: null, checkedFindingsMs: null, reviewedPublicationMs: null, maximumChargeUsd: a.maximumChargeUsd, commitmentsUsd: round(a.attempts.reduce((s, c) => s + c.amount, 0)), recordedTokenPriceCostUsd: a.attempts.every(c => c.status === 'completed' || c.status === 'released') ? round(a.attempts.reduce((s, c) => s + c.amount, 0)) : null, unresolvedHoldUsd: round(a.attempts.filter(c => c.status !== 'completed' && c.status !== 'released').reduce((s, c) => s + c.amount, 0)), attempts: a.attempts.map(c => ({ id: c.id, status: c.status, amount: c.amount, usage: c.metrics.tokens ?? c.metrics.usage ?? null })), providerEvidence: a.providerEvidence ?? null, validation: a.validation ?? null, validationError: a.validationError ?? null, error: a.error ?? null }));
    const audits = readdirSync(v.input).filter(p => /^audit-.*\.json$/.test(p)).map(p => { const a = z.looseObject({ version: z.literal('gemini-batch-audit.v1'), state: z.string(), videoId: z.string(), attempts: z.array(Attempt).default([]) }).parse(JSON.parse(readFileSync(join(v.input!, p), 'utf8'))); return { videoId: a.videoId, state: a.state, requestedModel: a.requestedModel, error: a.error ?? null, accepted: a.accepted ?? null, rejected: a.rejected ?? null, totalMs: a.totalMs, attempts: a.attempts ?? [] }; });
    const modeled = [50, 250, 1000].map(videosPerDay => ({ videosPerDay, totalDailyAtTargetUsd: videosPerDay * .15, totalDailyAtHardObjectiveUsd: videosPerDay * .5, example: economics(.2, .08, .01), exampleDailyNetUsd: round(videosPerDay * .17), kind: 'illustrative_not_measured' }));
    const result = { version: 'gemini-batch-report.v1', generatedAt: new Date().toISOString(), sampleCount: rows.length, uniqueVideos: new Set(rows.map(r => r.videoId)).size, recordedTokenPriceCostUsd: round(rows.reduce((s, r) => s + (r.recordedTokenPriceCostUsd ?? 0), audits.reduce((sum,a)=>sum+a.attempts.filter(c=>c.status==='completed').reduce((s,c)=>s+c.amount,0),0))), unresolvedHoldUsd: round(rows.reduce((s, r) => s + r.unresolvedHoldUsd, audits.reduce((sum,a)=>sum+a.attempts.filter(c=>c.status!=='completed'&&c.status!=='released').reduce((s,c)=>s+c.amount,0),0))), costBasis: 'Provider token usage × repository price table; not invoice-confirmed all-in charges. Unknown infra/audit/caption cost is not zero.', rows, audits, scaling: modeled, quality: { independentAudioReferences: 0, verifiedWer: null, verifiedCer: null, verifiedTimestampError: null, liveIndependentAudits: audits.filter(a=>a.state==='completed').length, reviewedPublications: 0, allInSavingMeasured: null }, breakEven: { formula: 'savingFraction = 0.5 * eligibleSpendFraction - incrementalOverheadUsd / synchronousAllInUsd', minimumEligibleFractionFor15PercentWithZeroOverhead: .3 } };
    const historicalCalls = v['historical-calls'], historicalRuns = v['historical-runs'];
    const historical = historicalCalls && historicalRuns ? (() => { const calls = JSON.parse(readFileSync(historicalCalls, 'utf8')), runs = JSON.parse(readFileSync(historicalRuns, 'utf8')); return { ...eligibleSpend(calls, runs), callsSha256: digest(calls), runsSha256: digest(runs) }; })() : null;
    const corpus = v.corpus ? z.object({ cases: z.array(z.looseObject({ videoId: z.string(), source: Source })) }).parse(JSON.parse(readFileSync(v.corpus, 'utf8'))) : null;
    const sourceAgreement = corpus ? readdirSync(v.input).filter(p => /^A-.*\.json$/.test(p) && !p.endsWith('.summary.json')).map(p => {
        const arm = z.looseObject({ videoId: z.string(), value: z.object({ segments: z.array(z.object({ text: z.string() })) }) }).parse(JSON.parse(readFileSync(join(v.input!, p), 'utf8')));
        const source = corpus.cases.find(c => c.videoId === arm.videoId)!.source;
        const reference = source.segments.filter(s => s.start_seconds !== null && s.end_seconds !== null && s.start_seconds >= 0 && s.end_seconds <= 30).map(s => s.text).join(' ');
        const hypothesis = arm.value.segments.map(s => s.text).join(' '), r = units(reference, 'en'), h = units(hypothesis, 'en'), edits = editCounts(r, h);
        return { videoId: arm.videoId, referenceKind: source.source_kind, referenceHash: digest(reference), candidateHash: digest(hypothesis), referenceUnits: r.length, candidateUnits: h.length, edits, normalizedEditAgreement: round(Math.max(0, 1 - edits.errors / Math.max(r.length, h.length))), boundaryCuesIndependentlyReviewed: false, scope: 'caption text agreement only; full cues within 0-30s; boundary omissions can inflate edit distance', verifiedWordErrorRate: null, verifiedCharacterErrorRate: null, verifiedTimestampError: null };
    }) : [];
    writeFileSync(v.output, JSON.stringify({ ...result, historical, sourceAgreement, pairedExtractionCosts: pairedCosts(rows) }, null, 2) + '\n');
    const columns = ['videoId', 'kind', 'mode', 'status', 'submissionOrCallMs', 'elapsedToLastObservationMs', 'recordedTokenPriceCostUsd', 'unresolvedHoldUsd', 'providerJob'];
    const csv = [columns, ...rows.map(r => columns.map(k => String((r as Record<string, unknown>)[k] ?? '')))].map(row => row.map(x => '"' + x.replaceAll('"', '""') + '"').join(',')).join('\n') + '\n';
    writeFileSync(v.output.replace(/\.json$/, '.csv'), csv);
    console.log(JSON.stringify({ arms: rows.length, recordedTokenPriceCostUsd: result.recordedTokenPriceCostUsd, unresolvedHoldUsd: result.unresolvedHoldUsd }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
    main();
