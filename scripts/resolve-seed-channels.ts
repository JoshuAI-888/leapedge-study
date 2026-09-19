/** Resolve archived Tier 1 handles against YouTube, without printing credentials.
 * Usage: node --experimental-strip-types scripts/resolve-seed-channels.ts /absolute/path/to/.env
 * Writes nonsecret evidence only; it never seeds a database or runs analysis. */
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { z } from "zod";
const envFile = process.argv[2];
if (!envFile)
  throw Error("Pass an environment file containing YOUTUBE_API_KEY.");
const { YOUTUBE_API_KEY } = parseEnv(readFileSync(envFile, "utf8"));
if (!YOUTUBE_API_KEY) throw Error("YOUTUBE_API_KEY is missing.");
const archive = "docs/archive/handoff-truealphadata.md";
const text = readFileSync(archive, "utf8")
  .split("### Tier 1 —")[1]
  ?.split("### Tier 2 —")[0];
if (!text) throw Error("Archived Tier 1 section is missing.");
const handles = [
  ...new Set(
    [...text.matchAll(/https:\/\/www\.youtube\.com\/(@[^)\s]+)/g)].map(
      (match) => match[1],
    ),
  ),
];
const schema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().regex(/^UC[\w-]{22}$/),
        snippet: z.object({
          title: z.string(),
          customUrl: z.string().optional(),
        }),
        contentDetails: z.object({
          relatedPlaylists: z.object({ uploads: z.string() }),
        }),
      }),
    )
    .default([]),
});
const lookups = [];
for (const handle of handles) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.search = new URLSearchParams({
    part: "snippet,contentDetails",
    forHandle: handle,
  }).toString();
  const response = await fetch(url, {
    headers: { "X-Goog-Api-Key": YOUTUBE_API_KEY },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Error(`YouTube handle lookup HTTP ${response.status} for ${handle}`);
  const result = schema.parse(await response.json());
  lookups.push({
    requestedHandle: handle,
    requestUrl: url.href,
    channels: result.items.map((item) => ({
      id: item.id,
      title: item.snippet.title,
      handle: item.snippet.customUrl,
      uploads: item.contentDetails.relatedPlaylists.uploads,
    })),
  });
}
const evidence = {
  asOf: new Date().toISOString(),
  sourceArchive: archive,
  sourceSection: "6 / Tier 1",
  classification:
    "Archived research-priority Tier 1, not a current performance ranking",
  provider: "YouTube Data API v3 channels.list",
  lookups,
};
writeFileSync(
  "docs/delivery/channel-seed-resolution.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  `Resolved ${lookups.length} archived handles; ${lookups.filter((row) => row.channels.length === 1).length} exact single-channel responses. Evidence saved without credentials.`,
);
