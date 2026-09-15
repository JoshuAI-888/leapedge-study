import { youtubeJsTranscript } from "../src/server/youtube-intelligence/youtubejs.ts";
import { doc } from "../src/server/youtube-intelligence/research-store.ts";
const ids = process.argv.slice(2);
if (!ids.length) throw Error("Pass one or more public YouTube video IDs.");
for (const id of ids) {
  const s = await youtubeJsTranscript(id);
  console.log(
    JSON.stringify({
      videoId: id,
      success: !!s,
      segments: s?.segments.length,
      language: s?.language,
      sourceKind: s?.source_kind,
      attempt: await doc("youtubeJsLastAttempt", id),
    }),
  );
}
