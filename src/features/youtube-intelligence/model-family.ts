import { z } from "zod";
/**
 * The vendor family of a model id, from the id alone.
 *
 * It is what the different-family critic rule compares (spec 4.1), and it
 * must not need a network call or a catalogue. Ids arrive in both shapes the
 * system uses — bare ("gemini-3.8-flash") and OpenRouter's
 * ("anthropic/claude-sonnet-5").
 *
 * It lives beside the settings schema rather than in the transport because
 * both sides need it: the transport enforces the rule and the legacy
 * migration has to know whether the document it is migrating can satisfy it.
 */
export const ModelFamily = z.enum([
  "google",
  "anthropic",
  "openai",
  "mistral",
  "meta",
  "other",
]);
export type ModelFamily = z.infer<typeof ModelFamily>;
const FAMILIES: [ModelFamily, RegExp][] = [
  ["google", /gemini|gemma|palm|bison|(^|\/)google/],
  ["anthropic", /claude|(^|\/)anthropic/],
  ["openai", /gpt|(^|\/)openai|(^|\/|-)o[1-9](\b|-)/],
  ["mistral", /mistral|mixtral|magistral|codestral|devstral/],
  ["meta", /llama|(^|\/)meta(-|\/)/],
];
export function modelFamily(id: string): ModelFamily {
  const name = id.toLowerCase();
  for (const [family, pattern] of FAMILIES) if (pattern.test(name)) return family;
  return "other";
}
