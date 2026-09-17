import { readFileSync } from "node:fs";
export const QUOTE_GUIDANCE =
  "\nEVIDENCE SERIALIZATION: Each evidence record must copy an exact substring from ONE supplied segment only. Never concatenate adjacent segment text into one quote, add boundary spaces, or rewrite punctuation. If a thesis needs multiple segments, provide separate evidence records with their actual segment IDs. Preserve every character in each quote; do not translate quote_original. All other v5 rules are unchanged.";
export function shadowPrompts(singleSegment: boolean) {
  const prompts = JSON.parse(
    readFileSync(
      new URL(
        "../../src/server/youtube-intelligence/prompt-versions.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).find((p: any) => p.id === "evidence-first.web.v5");
  if (!prompts) throw Error("Frozen v5 prompt missing");
  if (singleSegment) {
    prompts.id = "evidence-first.web.v5+single-segment-quotes.v1";
    prompts.extraction += QUOTE_GUIDANCE;
  }
  return prompts;
}
