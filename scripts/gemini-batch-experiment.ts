/** Isolated experiment driver. Default plan is keyless; paid work uses modelCall.
 * No worker, scheduler, provider fetch, publication or alternate ledger lives here.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { Source, deriveEvidence } from '../src/features/youtube-intelligence/contracts.ts';
import { TeamPreferences } from '../src/features/youtube-intelligence/settings.ts';
import { benchmarkBudgetCeiling } from './benchmark-controlled-models.ts';
export function experimentRouting(input: {
    origin: 'manual' | 'channel' | 'historical';
    batchEnabled: boolean;
    prerequisites: boolean;
    requiresMedia?: boolean;
    batchMediaVerified?: boolean;
}) {
    if (input.requiresMedia && !input.batchMediaVerified)
        return 'immediate';
    return input.origin !== 'manual' && input.batchEnabled && input.prerequisites ? 'batch' : 'immediate';
}
/** Deliberately prices the full asset at 300 tokens/second, even for a clip.
 * Current Flash rates; output includes thinking inside maxOutputTokens.
 */
export function mediaChargeBound(duration: number, outputTokens: number) {
    z.number().finite().positive().max(10800).parse(duration);
    z.number().int().positive().max(65536).parse(outputTokens);
    return Number(((duration * 300 * 0.75 + outputTokens * 3.75) / 1e6).toFixed(8));
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Experiment arms are driven explicitly, never by an automatic queue drain. */
export async function createParkedExperimentRun(...args: Parameters<typeof import('../src/server/youtube-intelligence/store.ts').create>) {
    const S=await import('../src/server/youtube-intelligence/store.ts');
    return S.db().transaction(async()=>{
        const run=await S.create(...args);
        await S.db().prepare("UPDATE yi_runs SET status='paused' WHERE id=$1").run(run.id);
        await S.db().prepare("UPDATE jobs SET status='failed',error='Manually driven isolated experiment; automatic analysis disabled' WHERE id=$1 AND status='queued'").run(`analyze:${run.id}`);
        run.status='paused';
        return run;
    });
}
const Case = z.object({ videoId: z.string().regex(/^[\w-]{11}$/), title: z.string(), sourceHash: z.string(), sourceBytesHash: z.string(),
    source: Source, metadata: z.looseObject({ duration: z.number().positive() }), promptSnapshot: z.looseObject({ id: z.string(), synthesis: z.string(), extraction: z.string(), structuredIdeas: z.boolean().optional(), callFields: z.boolean().optional() }), settings: TeamPreferences });
const Corpus = z.object({ version: z.literal('gemini-batch-corpus.v1'), campaignId: z.uuid(), maxUsd: z.number().positive().max(5), cases: z.array(Case).length(3) });
const MediaResponse = z.object({ audio_status: z.enum(['complete', 'inaccessible']), language: z.string(), segments: z.array(z.object({ text: z.string(), start_seconds: z.number(), end_seconds: z.number() })) });
const mediaPrompt = 'Listen independently to ONLY the supplied video window. Transcribe verbatim in the original spoken language; do not translate, summarize or infer missing speech. Preserve numbers, names, tickers, negations and conditions exactly. Use short segments and absolute seconds from the original video origin. Return audio_status complete only if the whole interval is accessible; otherwise inaccessible and no invented speech. Generated times remain unverified.';
function read(path: string) { return JSON.parse(readFileSync(path, 'utf8')); }
function write(path: string, value: unknown) { const tmp = path + '.writing'; writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); renameSync(tmp, path); }
function safeError(error: unknown) {
    let message = error instanceof Error ? error.message : String(error);
    for (const key of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
        if (process.env[key])
            message = message.replaceAll(process.env[key]!, '[REDACTED]');
    }
    return message.slice(0, 1800);
}
async function main() {
    const { values: v } = parseArgs({ options: { action: { type: 'string', default: 'plan' }, input: { type: 'string' }, corpus: { type: 'string' }, output: { type: 'string' }, kind: { type: 'string' }, mode: { type: 'string' }, video: { type: 'string' }, live: { type: 'boolean', default: false } } });
    const action = z.enum(['prepare', 'plan', 'run', 'poll', 'export']).parse(v.action);
    if (action === 'prepare') {
        if (!v.input || !v.output)
            throw Error('prepare requires --input saved-campaign.json --output private-corpus.json');
        const old = z.object({ arms: z.array(z.looseObject({ videoId: z.string(), title: z.string(), sourceHash: z.string(), input: z.record(z.string(), z.unknown()), output: z.record(z.string(), z.unknown()) })) }).parse(read(v.input));
        const cases = old.arms.map(a => Case.parse({ videoId: a.videoId, title: a.title, sourceHash: a.sourceHash, sourceBytesHash: digest(a.output.source), source: a.output.source, metadata: a.output.metadata, promptSnapshot: a.input.promptSnapshot, settings: a.input.teamPreferencesSnapshot }));
        const corpus = Corpus.parse({ version: 'gemini-batch-corpus.v1', campaignId: randomUUID(), maxUsd: 5, cases });
        mkdirSync(dirname(v.output), { recursive: true });
        writeFileSync(v.output, JSON.stringify(corpus, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        console.log(JSON.stringify({ prepared: cases.length, campaignId: corpus.campaignId, sourceHashes: cases.map(c => ({ videoId: c.videoId, sourceHash: c.sourceHash, sourceBytesHash: c.sourceBytesHash })) }));
        return;
    }
    if (action === 'plan') {
        const corpus = v.corpus ? Corpus.parse(read(v.corpus)) : null;
        console.log(JSON.stringify({ live: false, version: 'gemini-batch-experiment.v1', campaignId: corpus?.campaignId ?? null, maxAdditionalUsd: 5, maxPerArmUsd: 0.5, productionDefaultsChanged: false,
            cases: corpus?.cases.map(c => ({ videoId: c.videoId, title: c.title, durationSeconds: c.metadata.duration, sourceKind: c.source.source_kind, language: c.source.language, sourceHash: c.sourceHash, sourceBytesHash: c.sourceBytesHash, promptVersion: c.promptSnapshot.id, promptHash: digest(c.promptSnapshot), model: 'gemini-3.8-flash', sdk: '2.22.0', independentAudioReference: false, mediaConservativeMaximumUsd: mediaChargeBound(c.metadata.duration, 2048) })) ?? [], note: 'No DB/provider access. Each paid arm requires --live and an exclusive new manifest. Poll/export never submit.' }, null, 2));
        return;
    }
    if (!v.live || !v.output)
        throw Error('run/poll/export require --live --output manifest.json');
    if (process.env.YTI_ISOLATED_DB !== 'true' || process.env.YTI_DB === 'pglite' || !process.env.DATABASE_URL || !process.env.DATABASE_URL_UNPOOLED)
        throw Error('An explicitly isolated persistent Postgres pair is required.');
    // A localhost allowlist prevents accidentally writing a production or shared DB.
    for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'])
        if (!['127.0.0.1', 'localhost'].includes(new URL(process.env[key]!).hostname))
            throw Error('Experiment writes require a local isolated Postgres host.');
    process.env.YTI_QUEUE_PAUSED = 'true';
    process.env.YTI_CRON_ENABLED = 'false';
    process.env.YTI_EMAIL_SEND_ENABLED = 'false';
    const { database } = await import('../src/server/youtube-intelligence/database.ts');
    const S = await import('../src/server/youtube-intelligence/store.ts');
    const { modelCall, extractionPayload } = await import('../src/server/youtube-intelligence/pipeline.ts');
    const { batchRecord, pollBatch } = await import('../src/server/youtube-intelligence/batch.ts');
    const { teamPreferences } = await import('../src/server/youtube-intelligence/research-store.ts');
    let manifest: Record<string, unknown> = {};
    try {
        if (action === 'run') {
            if (!process.env.GEMINI_API_KEY)
                throw Error('GEMINI_API_KEY is not configured.');
            if (!v.corpus)
                throw Error('--corpus required');
            const corpus = Corpus.parse(read(v.corpus)), c = corpus.cases.find(c => c.videoId === v.video);
            if (!c)
                throw Error('Choose one video from the frozen corpus.');
            if (digest(c.source) !== c.sourceBytesHash)
                throw Error('Frozen source bytes changed.');
            const kind = z.enum(['media', 'text']).parse(v.kind), mode = z.enum(['immediate', 'batch']).parse(v.mode);
            // Never overwrite or resume a submitting manifest. A crash is operator reconciliation.
            manifest = { version: 'gemini-batch-arm.v1', state: 'initializing', campaignId: corpus.campaignId, kind, mode, videoId: c.videoId, createdAt: new Date().toISOString(), paidWorkStarted: false };
            mkdirSync(dirname(v.output), { recursive: true });
            writeFileSync(v.output, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
            const initial = (await S.health()).spentOrReservedUsd;
            const existing = process.env.YTI_BUDGET_USD;
            process.env.YTI_BUDGET_USD = String(benchmarkBudgetCeiling(existing === undefined ? undefined : Number(existing), initial, corpus.maxUsd));
            const admin = await teamPreferences();
            const perArmCap = Math.min(0.5, admin.budget.perVideoMaxUsd, c.settings.budget.perVideoMaxUsd);
            if (perArmCap <= 0)
                throw Error('No per-video budget available.');
            const settings = structuredClone(c.settings);
            settings.budget.perVideoMaxUsd = perArmCap;
            settings.processing.maxRetriesPerStage = 0;
            settings.transport.fallbackToOpenRouter = false;
            settings.processing.contextCaching = false;
            for (const k of ['transcription', 'extraction', 'translation'] as const)
                settings.models[k] = { ...settings.models[k], id: 'gemini-3.8-flash', transport: 'google-native' };
            const maxOutputTokens = kind === 'media' ? 2048 : 24000;
            const maximumChargeUsd = kind === 'media' ? mediaChargeBound(c.metadata.duration, maxOutputTokens) : (Buffer.byteLength(JSON.stringify(c.source)) * 2 * 0.75 + maxOutputTokens * 3.75) / 1e6;
            if (maximumChargeUsd > perArmCap)
                throw Error('Conservative full-price maximum exceeds per-video guard.');
            const { extractionSchemaFor, FINANCIAL_SEMANTICS, RESEARCH_CONTEXT_POLICY } = await import('../src/server/youtube-intelligence/schemas/extraction.ts');
            const prompt = kind === 'media' ? mediaPrompt : c.promptSnapshot.synthesis + '\n' + c.promptSnapshot.extraction + '\n' + FINANCIAL_SEMANTICS + RESEARCH_CONTEXT_POLICY;
            const payload = kind === 'media' ? { window_start_seconds: 0, window_end_seconds: 30 } : extractionPayload(c.source.segments, 0, 1, true);
            const responseSchema = kind === 'media' ? z.toJSONSchema(MediaResponse) : extractionSchemaFor(c.promptSnapshot);
            const options = { settings, responseSchema, maxOutputTokens, reasoningEffort: 'low' };
            const stage = kind === 'media' ? 'transcribe-asr-0-30' : 'synthesis';
            const run = await createParkedExperimentRun(c.videoId, 'gemini-3.8-flash', { task: 'gemini-batch-experiment', experiment: true, processingMode: mode, teamPreferencesSnapshot: settings, benchmarkCampaign: { id: corpus.campaignId, maxUsd: corpus.maxUsd }, caseHash: digest(c), arm: randomUUID() }, c.promptSnapshot.id);
            run.status = 'paused';
            run.output = { source: c.source, sourceHash: c.sourceHash, metadata: c.metadata };
            await database.prepare("UPDATE yi_runs SET status='paused',output=$1 WHERE id=$2").run(JSON.stringify(run.output), run.id);
            manifest = { ...manifest, runId: run.id, stage, sourceHash: c.sourceHash, sourceBytesHash: c.sourceBytesHash, promptVersion: c.promptSnapshot.id, promptHash: digest(prompt), payloadHash: digest(payload), schemaHash: digest(responseSchema), requestedModel: run.model, sdk: '2.22.0', maximumChargeUsd, perArmCapUsd: perArmCap, initialCommitmentsUsd: initial, effectiveLifetimeCapUsd: Number(process.env.YTI_BUDGET_USD), request: { prompt, payload, options }, paidWorkStarted: true, state: 'submitting' };
            write(v.output, manifest);
            const start = performance.now();
            try {
                manifest.value = await modelCall(run, stage, run.model, prompt, payload, kind === 'media', options);
                manifest.state = 'received';
            }
            catch (error) {
                manifest.error = safeError(error);
                manifest.state = (await batchRecord(run.id, stage))?.status === 'pending' ? 'pending' : 'stopped';
            }
            manifest.submissionOrCallMs = performance.now() - start;
        }
        else {
            manifest = z.looseObject({ version: z.literal('gemini-batch-arm.v1'), runId: z.string(), stage: z.string() }).parse(read(v.output));
            if (action === 'poll') {
                if (manifest.mode !== 'batch')
                    throw Error('Only an existing batch arm may be polled.');
                const record = await batchRecord(String(manifest.runId), String(manifest.stage));
                if (!record?.name)
                    throw Error('No known provider name; reconcile submission manually.');
                const start = performance.now();
                try {
                    await pollBatch(record.id);
                    manifest.state = (await batchRecord(record.runId, record.stage))?.status;
                    delete manifest.error;
                }
                catch (error) {
                    manifest.error = safeError(error);
                    manifest.state = (await batchRecord(record.runId, record.stage))?.status;
                }
                manifest.lastPollMs = performance.now() - start;
                manifest.observations = [...z.array(z.unknown()).parse(manifest.observations ?? []), { observedAt: new Date().toISOString(), state: manifest.state, pollMs: manifest.lastPollMs }];
                if (manifest.state === 'completed') {
                    const rec = (await batchRecord(record.runId, record.stage))!;
                    const normalized = z.object({ text: z.string(), finishReason: z.string().optional() }).parse(await S.retainedResponse(rec.callId + ':normalized'));
                    if (normalized.finishReason !== 'stop')
                        manifest.validationError = 'Incomplete provider output; no usable result';
                    else
                        try {
                            manifest.value = JSON.parse(normalized.text);
                        }
                        catch {
                            manifest.validationError = 'Provider response was not valid JSON';
                        }
                }
            }
        }
        const run = await S.get(String(manifest.runId));
        if (!run)
            throw Error('Manifest run missing');
        manifest.batch = await batchRecord(run.id, String(manifest.stage));
        const attempts = await S.listAttempts(run.id, String(manifest.stage));
        manifest.attempts = attempts;
        manifest.updatedAt = new Date().toISOString();
        const settledAt = attempts.find(a => a.status === 'completed')?.metrics.settledAt;
        if (typeof settledAt === 'string')
            manifest.firstResultObservedAt ??= settledAt;
        const raw = attempts.length ? await S.retainedResponse(attempts.at(-1)!.id) : null;
        if (raw) {
            const envelope = z.looseObject({ modelVersion: z.string().optional(), usageMetadata: z.unknown().optional() }).parse(raw);
            manifest.providerEvidence = { servedModelVersion: envelope.modelVersion ?? null, usageMetadata: envelope.usageMetadata ?? null, responseSha256: digest(raw) };
        }
        if (manifest.value) {
            try {
                if (manifest.kind === 'media') {
                    const { parseWindow } = await import('../src/server/youtube-intelligence/windowed-asr.ts');
                    const parsed = parseWindow(manifest.value, { startSeconds: 0, endSeconds: 30 }, 0);
                    manifest.validation = { schemaAndBounds: true, accessible: parsed.audioStatus === 'complete', segments: parsed.segments.length, language: parsed.language, verifiedAccuracy: null, verifiedTimestampError: null };
                    if (parsed.audioStatus !== 'complete')
                        manifest.validationError = 'Unsupported or inaccessible media; stop this media branch.';
                }
                else {
                    const { parsePointerExtraction } = await import('../src/server/youtube-intelligence/schemas/extraction.ts');
                    const extracted = parsePointerExtraction(manifest.value);
                    let pointers = 0;
                    const ranges = [...extracted.claims, ...extracted.key_points].flatMap(item => item.evidence_ranges).concat(extracted.mentions.flatMap(item => item.ranges));
                    for (const range of ranges) {
                        deriveEvidence(Source.parse(run.output.source), range);
                        pointers++;
                    }
                    manifest.validation = { schemaAndPointers: true, claims: extracted.claims.length, keyPoints: extracted.key_points.length, mentions: extracted.mentions.length, pointers, independentCritique: 'not_run', publication: 'not_attempted', researchFidelity: 'unverified' };
                }
            }
            catch (error) {
                manifest.validationError = safeError(error);
            }
        }
        write(v.output, manifest);
        const { request: privateRequest, value: privateValue, ...summary } = manifest;
        void privateRequest;
        void privateValue;
        write(v.output + '.summary.json', summary);
        console.log(JSON.stringify({ state: manifest.state, runId: run.id, batch: manifest.batch, attempts: manifest.attempts, validation: manifest.validation, validationError: manifest.validationError, error: manifest.error }));
    }
    finally {
        await database.close();
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
    main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
