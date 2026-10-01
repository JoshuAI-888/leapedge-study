import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withOpenRouterFallback,
  type ModelTransport,
} from "../src/server/youtube-intelligence/transport/index.ts";

const transport = (
  rates: { inputRate: number; audioRate: number; outputRate: number },
  contextLength = 10000,
): ModelTransport => ({
  name: "test",
  family: "fake",
  describe: async () => ({
    ...rates,
    contextLength,
    supportedEfforts: ["low"],
  }),
  call: async () => {
    throw Error("No model call is allowed in this pricing test");
  },
});
test("A fallback-enabled reservation covers either vendor before any paid request", async () => {
  const wrapped = withOpenRouterFallback(
    transport({ inputRate: 1, audioRate: 7, outputRate: 2 }),
    transport({ inputRate: 3, audioRate: 5, outputRate: 4 }, 8000),
  );
  const spec = await wrapped.describe("model");
  assert.equal(spec.inputRate, 3);
  assert.equal(spec.audioRate, 7);
  assert.equal(spec.outputRate, 4);
  assert.equal(spec.contextLength, 8000);
});
test("Unknown fallback prices fail before a primary request can create an underfunded hold", async () => {
  const secondary = transport({ inputRate: 1, audioRate: 1, outputRate: 1 });
  secondary.describe = async () => {
    throw Error("catalogue unavailable");
  };
  await assert.rejects(
    withOpenRouterFallback(
      transport({ inputRate: 1, audioRate: 1, outputRate: 1 }),
      secondary,
    ).describe("model"),
    /catalogue unavailable/,
  );
});
