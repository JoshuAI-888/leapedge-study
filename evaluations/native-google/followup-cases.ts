import { readFileSync } from "node:fs";
import type { GenerateContentParameters } from "@google/genai";
import { requestFor, type TestInput } from "./core.ts";
export const FOLLOWUP_VERSION = "native-followup.v1";
export const CASES = [
  "schema-no-max",
  "schema-small-max",
  "macro-window-a",
  "macro-window-b",
] as const;
export type CaseName = (typeof CASES)[number];
export function buildCase(name: CaseName, signal: AbortSignal) {
  let input: TestInput;
  let request: GenerateContentParameters;
  let hypothesis: string;
  if (name.startsWith("schema-")) {
    input = {
      videoId: "SHMPiWbbR6E",
      durationSeconds: 165,
      startSeconds: 0,
      endSeconds: 165,
      mode: "STATIC",
    };
    request = JSON.parse(
      readFileSync(
        new URL("./fixtures/rejected-schema-request.json", import.meta.url),
        "utf8",
      ),
    );
    const schema = request.config!.responseJsonSchema as any;
    if (name === "schema-no-max") delete schema.properties.segments.maxItems;
    else schema.properties.segments.maxItems = 500;
    request.config!.abortSignal = signal;
    hypothesis =
      "A large maxItems constraint, rather than JSON-schema transport itself, may cause schema complexity rejection. Only maxItems changes from the saved failing request.";
  } else {
    input = {
      videoId: "J25UuUqHT3Y",
      durationSeconds: 1919,
      startSeconds: name === "macro-window-a" ? 1170 : 1200,
      endSeconds: name === "macro-window-a" ? 1260 : 1290,
      mode: "STATIC",
    };
    request = requestFor(input, signal);
    hypothesis =
      "A 90-second static window may avoid the out-of-duration timestamp in the full-video output. Overlapping outputs are consistency checks, not independent audio truth.";
  }
  return { input, request, hypothesis };
}
