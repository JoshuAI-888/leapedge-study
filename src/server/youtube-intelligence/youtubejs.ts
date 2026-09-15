import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  Source,
  type SourceData,
} from "../../features/youtube-intelligence/contracts.ts";
import { doc, put } from "./research-store.ts";
const Payload = z.object({
  videoId: z.string().regex(/^[\w-]{11}$/),
  language: z.string().optional(),
  selectedLanguage: z.string(),
  availableLanguages: z.array(z.string()),
  trackKind: z.enum(["manual", "automatic", "unknown"]),
  segments: z
    .array(
      z.object({
        text: z.string().min(1),
        startMs: z.number().finite().nonnegative(),
        endMs: z.number().finite().nonnegative(),
      }),
    )
    .min(1),
});
export function normalizeYouTubeJs(
  value: unknown,
  videoId: string,
): SourceData {
  const p = Payload.parse(value);
  if (p.videoId !== videoId) throw Error("Transcript video ID mismatch.");
  return Source.parse({
    video_id: videoId,
    language: p.language || p.selectedLanguage,
    source_kind: "native_captions_youtubejs",
    segments: p.segments.map((s, i) => ({
      id: `s${String(i + 1).padStart(5, "0")}`,
      text: s.text,
      start_seconds: s.startMs / 1000,
      end_seconds: s.endMs / 1000,
    })),
  });
}
export async function fetchYouTubeJs(videoId: string) {
  if (!/^[\w-]{11}$/.test(videoId)) throw Error("Invalid video ID.");
  const { Innertube, YTNodes, Log } = await import("youtubei.js");
  // Parser warnings can contain upstream responses. Retain only our structured diagnostics.
  Log.setLevel(Log.Level.NONE);
  const signal = AbortSignal.timeout(45000);
  const yt = await Innertube.create({
    retrieve_player: false,
    generate_session_locally: true,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
      }),
  });
  const info = await yt.getInfo(videoId);
  const transcript = await info.getTranscript();
  const selected = transcript.selectedLanguage;
  const track = info.captions?.caption_tracks?.find(
    (t) => t.name.toString() === selected,
  );
  const payload = Payload.parse({
    videoId,
    language: track?.language_code,
    selectedLanguage: selected,
    availableLanguages: transcript.languages,
    trackKind: track
      ? track.kind === "asr"
        ? "automatic"
        : "manual"
      : "unknown",
    segments:
      transcript.transcript.content?.body?.initial_segments
        .filterType(YTNodes.TranscriptSegment)
        .map((s) => ({
          text: s.snippet.toString(),
          startMs: Number(s.start_ms),
          endMs: Number(s.end_ms),
        })) || [],
  });
  return { payload, source: normalizeYouTubeJs(payload, videoId) };
}
export async function youtubeJsTranscript(
  videoId: string,
  fetcher = fetchYouTubeJs,
): Promise<SourceData | null> {
  if (process.env.YTI_YOUTUBEJS_ENABLED === "false") return null;
  const cached = await doc<{
    source: SourceData;
  }>("youtubeJsTranscript", videoId);
  if (cached) return Source.parse(cached.source);
  const previous = await doc<{
    at: string;
    status: string;
  }>("youtubeJsLastAttempt", videoId);
  // A failed free lookup can be retried after 15 minutes; prevent hammering across A/B runs.
  if (previous && Date.now() - Date.parse(previous.at) < 15 * 60000)
    return null;
  const id = randomUUID(),
    at = new Date().toISOString(),
    started = Date.now();
  await put("youtubeJsLastAttempt", videoId, { at, status: "started", id });
  try {
    const { source, payload } = await fetcher(videoId);
    const checked = normalizeYouTubeJs(payload, videoId);
    if (JSON.stringify(checked) !== JSON.stringify(source))
      throw Error("Inconsistent normalized source.");
    const snapshot = {
      id,
      videoId,
      at,
      status: "completed",
      durationMs: Date.now() - started,
      apiCostUsd: 0,
      source: checked,
      payload,
      sourceHash: createHash("sha256")
        .update(JSON.stringify(checked))
        .digest("hex"),
      limitation:
        "Caption text is retained as supplied; it has not been verified against audio.",
    };
    await put("youtubeJsAttempt", id, snapshot);
    await put("youtubeJsTranscript", videoId, snapshot);
    await put("youtubeJsLastAttempt", videoId, { id, at, status: "completed" });
    return checked;
  } catch (e) {
    // Do not retain exception messages: libraries may include signed URLs or response data.
    const errorType =
      e instanceof z.ZodError
        ? "invalid_response"
        : e instanceof Error && /timeout|abort/i.test(e.name)
          ? "timeout"
          : "retrieval_failed";
    const record = {
      id,
      videoId,
      at,
      status: "failed",
      errorType,
      durationMs: Date.now() - started,
      apiCostUsd: 0,
      reason:
        "Free caption retrieval failed or returned an invalid transcript. Existing configured fallback may be used.",
    };
    await put("youtubeJsAttempt", id, record);
    await put("youtubeJsLastAttempt", videoId, record);
    return null;
  }
}
