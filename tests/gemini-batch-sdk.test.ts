import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleGenAI } from '@google/genai';
import { stubFetch, json } from './helpers/fetch-stub.ts';
import { GoogleNativeTransport } from '../src/server/youtube-intelligence/transport/google-native.ts';
import { ModelRequest } from '../src/server/youtube-intelligence/transport/types.ts';
test('pinned SDK serializes one and grouped keyed GenerateContent requests with identical media config', async () => {
    const request = ModelRequest.parse({ stage: 'transcribe-asr-0-30', model: 'gemini-3.8-flash', video: { type: 'video', url: 'https://www.youtube.com/watch?v=9hE5-98ZeCg', startSeconds: 0, endSeconds: 30 }, user: [{ type: 'text', text: 'original speech only' }], system: [{ type: 'text', text: 'fixture' }], responseSchema: { type: 'object', properties: { language: { type: 'string' } } }, reasoningEffort: 'low', maxOutputTokens: 2048, temperature: 0 });
    const p = new GoogleNativeTransport().parameters(request);
    const { httpOptions, abortSignal, ...config } = p.config!;
    void httpOptions;
    void abortSignal;
    const stub = stubFetch([{ url: ':batchGenerateContent', method: 'POST', respond: () => json({ name: 'batches/wire', metadata: { state: 'BATCH_STATE_PENDING' } }) }]);
    try {
        const sdk = new GoogleGenAI({ apiKey: 'offline-fixture-key', httpOptions: { retryOptions: { attempts: 1 } } });
        for (const count of [1, 3]) {
            await sdk.batches.create({ model: p.model, src: Array.from({ length: count }, (_, i) => ({ contents: p.contents, config, metadata: { key: `case-${i}` } })) });
            const body = JSON.parse(stub.calls().at(-1)!.body!);
            const rows = body.batch.inputConfig.requests.requests;
            assert.equal(rows.length, count);
            assert.equal(new Set(rows.map((r: {
                metadata: {
                    key: string;
                };
            }) => r.metadata.key)).size, count);
            assert.deepEqual(rows[0].request.contents[0].parts[0], { fileData: { fileUri: request.video!.url, mimeType: 'video/*' }, videoMetadata: { startOffset: '0s', endOffset: '30s' } });
            assert.equal(rows[0].request.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_LOW');
            assert.deepEqual(rows[0].request.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
            assert.deepEqual(rows[0].request.systemInstruction, { role: 'system', parts: [{ text: 'fixture' }] });
            assert.ok(rows[0].request.generationConfig.responseSchema);
            assert.equal(body.batch.inputConfig.requests.requests[0].request.generationConfig.httpOptions, undefined);
        }
    }
    finally {
        stub.restore();
    }
});
