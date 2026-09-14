import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { GoogleGenAI } from "@google/genai";
import { execute, type TestInput } from "./core.ts";
const input: TestInput = {
  videoId: "CMjt6f4eVdA",
  durationSeconds: 100,
  startSeconds: 20,
  endSeconds: 80,
  mode: "STATIC",
};
async function server(
  handler: (r: IncomingMessage, s: ServerResponse) => void,
) {
  const s = createServer(handler);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const a = s.address();
  if (!a || typeof a === "string") throw Error("No address");
  const ai = new GoogleGenAI({
    apiKey: "local-test-not-a-key",
    httpOptions: {
      baseUrl: `http://127.0.0.1:${a.port}`,
      retryOptions: { attempts: 1 },
    },
  });
  return {
    ai,
    close: async () => {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    },
  };
}
test("Actual SDK serializes native media settings and does not retry HTTP503", async () => {
  let calls = 0,
    body: any;
  const fixture = await server((req, res) => {
    calls++;
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      body = JSON.parse(raw);
      res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            code: 503,
            status: "UNAVAILABLE",
            message: "Synthetic upstream failure",
          },
        }),
      );
    });
  });
  try {
    const result = await execute(
      input,
      (r) => fixture.ai.models.generateContent(r),
      3000,
    );
    assert.equal(calls, 1);
    assert.equal(result.assessment.outcome, "api_error_requires_diagnosis");
    const part = body.contents[0].parts[0];
    assert.equal(
      part.fileData.fileUri,
      "https://www.youtube.com/watch?v=CMjt6f4eVdA",
    );
    assert.equal(part.mediaProcessing, "STATIC");
    assert.equal(part.videoMetadata.startOffset, "20s");
    assert.equal(part.videoMetadata.endOffset, "80s");
  } finally {
    await fixture.close();
  }
});
test("Actual SDK request is aborted at the connected deadline", async () => {
  let calls = 0;
  const fixture = await server((req, _res) => {
    calls++;
    req.resume();
  });
  try {
    const result = await execute(
      input,
      (r) => fixture.ai.models.generateContent(r),
      100,
    );
    assert.equal(calls, 1);
    assert.equal(result.assessment.outcome, "transport_uncertain_timeout");
  } finally {
    await fixture.close();
  }
});
