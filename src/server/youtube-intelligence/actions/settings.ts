import { z } from "zod";
import * as R from "../research-store.ts";
import { reads, writes, nothing, type ActionTable } from "./types.ts";
export const settings: ActionTable = {
  current: reads(nothing, async () => ({ preferences: await R.preferences() })),
  preferences: writes(z.strictObject(R.Preferences.shape), (v) =>
    R.savePreferences(v),
  ),
  // "Use as new version" prefills the textarea with a snapshot prompt version,
  // which the registry has decorated with its own hash and created_at. Those
  // two are declared so the operator's paste is accepted, and dropped here so
  // nothing but a version reaches the store.
  prompt: writes(
    z.strictObject({
      ...R.PromptVersion.shape,
      hash: z.string().optional(),
      createdAt: z.string().optional(),
    }),
    ({ hash, createdAt, ...version }) => R.addPrompt(version),
  ),
};
