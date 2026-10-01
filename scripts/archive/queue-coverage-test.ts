import {
  addPrompt,
  promptVersions,
  queue,
  improvement,
  docs,
} from "../src/server/youtube-intelligence/research-store.ts";
import { get, list } from "../src/server/youtube-intelligence/store.ts";
const base = (await promptVersions()).find(
    (p) => p.id === "evidence-first.web.v1",
  )!,
  id = "evidence-first.web.v3";
if (!(await promptVersions()).some((p) => p.id === id))
  await addPrompt({
    ...base,
    id,
    rationale:
      "Recover source-wide coverage and separate educational/macro key points from trading claims without weakening original evidence checks.",
    synthesis:
      base.synthesis +
      "\nReturn TWO top-level arrays: claims and key_points, both using the supplied complete claim object schema. claims contains creator instrument-specific research views or conditional position instructions. key_points contains educational process, macro explanations and other material context. For key_points use neutral stance, null ticker, ticker_explicit false, unspecified conviction, and original quotes. Educational examples never become trade calls.\nBefore final output, inventory EVERY source section, including the final third. Ensure each explicit recommendation or existing-position instruction is represented in claims, and each materially distinct explanatory point in key_points. Do not output the inventory. Do not collapse multiple instrument-specific recommendations into one if conditions differ. Pay special attention to portfolio-allocation advice near the ending. Quality is supported coverage, not minimum word count.\n",
    critique:
      base.critique +
      "\nFor neutral educational key points, verify the stated process without treating it as a trade. Keep explicit conditional and existing-position instructions when faithful; do not demand a new-entry recommendation.\n",
  });
const old = (await get("22a99713-f00a-4a2f-b98e-bf66d3438ce7"))!;
if (
  !(await list()).some(
    (r) => r.promptVersion === id && r.videoId === old.videoId,
  )
) {
  const r = await queue(
    old.videoId,
    old.output.source,
    {
      promptVersion: id,
      model: "google/gemini-3.8-flash",
      criticModel: "google/gemini-3.8-flash",
    },
    true,
  );
  console.log(JSON.stringify({ candidate: r.id, prompt: id }));
}
