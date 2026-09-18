import { z } from "zod";
import * as R from "../research-store.ts";
import { reads, writes, nothing, type ActionTable } from "./types.ts";
export const settings: ActionTable = {
  current: reads(nothing, async () => ({ preferences: await R.preferences() })),
  preferences: writes(z.strictObject(R.Preferences.shape), (v) =>
    R.savePreferences(v),
  ),
  prompt: writes(z.strictObject(R.PromptVersion.shape), (v) => R.addPrompt(v)),
};
