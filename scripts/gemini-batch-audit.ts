/** Independent diagnostic critique of experimental extractions. Uses normal
 * modelCall, frozen source, faithful-audit instructions/schema and campaign cap.
 * Does not publish or award trust. Raw responses stay in private evidence.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Source, deriveEvidence } from '../src/features/youtube-intelligence/contracts.ts';
import { TeamPreferences } from '../src/features/youtube-intelligence/settings.ts';
import { digest, createParkedExperimentRun } from './gemini-batch-experiment.ts';
const Item = z.object({ thesis_en: z.string(), evidence_ranges: z.array(z.object({ start_id: z.string(), end_id: z.string() })) });
export function auditItems(raw: unknown, sourceRaw: unknown) {
    const extraction = z.object({ claims: z.array(Item), key_points: z.array(Item) }).parse(raw), source = Source.parse(sourceRaw);
    const items = [...extraction.claims.map((c, i) => ({ ...c, id: `c${i}` })), ...extraction.key_points.map((c, i) => ({ ...c, id: `k${i}` }))];
    return {
        sentences: items.map(c => ({ id: c.id, text: c.thesis_en, evidenceIds: [c.id] })),
        evidence: items.map(c => ({ id: c.id, quotes: c.evidence_ranges.map(r => ({ text: deriveEvidence(source, r).quote_original })) })),
        assessEvidenceIds: items.map(c => c.id), otherSentencesCitingAssessedEvidence: [],
    };
}
async function main() {
    const { values: v } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' }, corpus: { type: 'string' }, live: { type: 'boolean', default: false } } });
    if (!v.input || !v.output || !v.corpus)
        throw Error('--input completed-arm.json --corpus private-corpus.json --output new-audit.json required');
    const arm = z.looseObject({ version: z.literal('gemini-batch-arm.v1'), videoId: z.string(), campaignId: z.uuid(), runId: z.string(), value: z.unknown() }).parse(JSON.parse(readFileSync(v.input, 'utf8')));
    const corpus = z.object({ maxUsd: z.number().positive().max(5), cases: z.array(z.looseObject({ videoId: z.string(), source: Source, settings: TeamPreferences })) }).parse(JSON.parse(readFileSync(v.corpus, 'utf8')));
    const c = corpus.cases.find(c => c.videoId === arm.videoId);
    if (!c)
        throw Error('Frozen source missing');
    const payload = auditItems(arm.value, c.source), ids = payload.sentences.map(s => s.id);
    if (!v.live) {
        console.log(JSON.stringify({ live: false, items: ids.length, payloadHash: digest(payload), critic: c.settings.models.critique, paidCalls: 0 }));
        return;
    }
    if (process.env.YTI_ISOLATED_DB !== 'true' || process.env.YTI_DB === 'pglite' || !process.env.DATABASE_URL || !['127.0.0.1', 'localhost'].includes(new URL(process.env.DATABASE_URL).hostname))
        throw Error('Isolated persistent local database required');
    process.env.YTI_QUEUE_PAUSED = 'true';
    process.env.YTI_CRON_ENABLED = 'false';
    process.env.YTI_EMAIL_SEND_ENABLED = 'false';
    const settings = c.settings;
    settings.processing.maxRetriesPerStage = 0;
    settings.transport.fallbackToOpenRouter = false;
    settings.budget.perVideoMaxUsd = Math.min(.5, settings.budget.perVideoMaxUsd);
    const { assertCriticIndependent, transportFor } = await import('../src/server/youtube-intelligence/transport/index.ts');
    assertCriticIndependent(settings);
    const { FAITHFUL_INSTRUCTIONS, FaithfulResponse } = await import('../src/server/youtube-intelligence/faithful-audit.ts');
    const { modelCall } = await import('../src/server/youtube-intelligence/pipeline.ts');
    const S = await import('../src/server/youtube-intelligence/store.ts');
    const output: Record<string, unknown> = { version: 'gemini-batch-audit.v1', parentRunId: arm.runId, campaignId: arm.campaignId, videoId: arm.videoId, mode: arm.mode, requestedModel: settings.models.critique.id, sourceHash: digest(c.source), payloadHash: digest(payload), promptHash: digest(FAITHFUL_INSTRUCTIONS), state: 'initializing', createdAt: new Date().toISOString() };
    try {
        writeFileSync(v.output, JSON.stringify(output, null, 2), { flag: 'wx', mode: 0o600 });
        const price = await transportFor('critique', settings).describe(settings.models.critique.id);
        const maximum = Buffer.byteLength(FAITHFUL_INSTRUCTIONS + JSON.stringify(payload)) * price.inputRate + 6000 * price.outputRate;
        if (maximum > settings.budget.perVideoMaxUsd)
            throw Error('Conservative critique maximum exceeds cap');
        output.maximumChargeUsd = maximum;
        const run = await createParkedExperimentRun(arm.videoId, settings.models.extraction.id, { task: 'gemini-batch-audit', experiment: true, processingMode: 'immediate', teamPreferencesSnapshot: settings, benchmarkCampaign: { id: arm.campaignId, maxUsd: corpus.maxUsd }, parentRunId: arm.runId }, 'faithful-audit.v1');
        output.runId = run.id;
        await S.db().prepare("UPDATE yi_runs SET status='paused' WHERE id=$1").run(run.id);
        writeFileSync(v.output, JSON.stringify(output, null, 2));
        const start = performance.now();
        try {
            const response = FaithfulResponse.parse(await modelCall(run, 'critique', settings.models.critique.id, FAITHFUL_INSTRUCTIONS, payload, false, { settings, responseSchema: z.toJSONSchema(FaithfulResponse), maxOutputTokens: 6000, reasoningEffort: 'low' }));
            if (response.verdicts.length !== ids.length || new Set(response.verdicts.map(x => x.id)).size !== ids.length || response.verdicts.some(x => !ids.includes(x.id)))
                throw Error('Missing, duplicate or foreign critique IDs');
            output.response = response;
            output.state = 'completed';
            output.accepted = response.verdicts.filter(v => v.accepted).length;
            output.rejected = response.verdicts.filter(v => !v.accepted).length;
        }
        catch (error) {
            output.state = 'stopped';
            let message = error instanceof Error ? error.message : 'Critique failed';
            for (const name of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED'])
                if (process.env[name])
                    message = message.replaceAll(process.env[name]!, '[REDACTED]');
            output.error = message.slice(0, 1800);
        }
        output.totalMs = performance.now() - start;
        output.attempts = await S.listAttempts(run.id, 'critique');
        output.updatedAt = new Date().toISOString();
        writeFileSync(v.output, JSON.stringify(output, null, 2) + '\n');
        console.log(JSON.stringify({ state: output.state, accepted: output.accepted, rejected: output.rejected, totalMs: output.totalMs, error: output.error }));
    }
    finally {
        await S.db().close();
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
    main().catch(e => {
        let message = e instanceof Error ? e.message : String(e);
        for (const key of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY'])
            if (process.env[key])
                message = message.replaceAll(process.env[key]!, '[REDACTED]');
        console.error(message);
        process.exitCode = 1;
    });
