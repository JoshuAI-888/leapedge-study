import type { SourceData, ClaimData } from "./contracts.ts";
/**
 * The local token floor: bytes/4. Used wherever the provider's own count is
 * unavailable (spec 4.3), so a decision that depends on transcript size is
 * always answerable offline and never blocks on a network call.
 */
export function estimateTokens(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.ceil(new TextEncoder().encode(text).length / 4);
}
/**
 * Transcript chunks for a model stage (spec 4.3): one chunk — the whole
 * transcript — unless its token estimate exceeds `maxTokens`, in which case it
 * is split into windows of that size with the same overlap sourceChunks uses.
 *
 * The old fixed 64 KB split multiplied both extraction and critique calls on
 * transcripts a 1M-token window swallows whole; `processing.chunkAboveTokens`
 * is the only reason to chunk now, and `tokens` lets a caller pass a provider
 * count instead of the local floor.
 */
export function transcriptChunks(
  source: SourceData,
  maxTokens: number,
  tokens = estimateTokens(source.segments),
) {
  if (tokens <= maxTokens) return [source.segments];
  return sourceChunks(source, Math.max(4000, Math.floor(maxTokens) * 4));
}
export function sourceChunks(
  source: SourceData,
  maxBytes = 64000,
  overlap = 3,
) {
  const chunks: SourceData["segments"][] = [];
  let current: SourceData["segments"] = [],
    size = 0;
  for (const segment of source.segments) {
    const bytes = new TextEncoder().encode(JSON.stringify(segment)).length;
    if (bytes > maxBytes)
      throw Error(
        "One transcript segment exceeds the context limit; split it at its original timing boundaries.",
      );
    if (current.length && size + bytes > maxBytes) {
      chunks.push(current);
      current = current.slice(
        -Math.min(overlap, Math.max(0, current.length - 1)),
      );
      size = new TextEncoder().encode(JSON.stringify(current)).length;
      while (current.length && size + bytes > maxBytes) {
        current.shift();
        size = new TextEncoder().encode(JSON.stringify(current)).length;
      }
    }
    current.push(segment);
    size += bytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
export function uniqueClaims(claims: ClaimData[]) {
  const seen = new Set<string>();
  return claims.filter((c) => {
    const key = JSON.stringify([
      c.thesis_en,
      c.instrument_as_spoken,
      c.ticker,
      c.ticker_explicit,
      c.stance,
      c.horizon_en,
      c.creator_conviction,
      c.conditions_en,
      c.risks_en,
      c.levels,
      c.evidence
        .map((e) => [
          e.segment_id,
          e.end_segment_id,
          e.quote_original,
          e.quote_translation_en,
        ])
        .sort(),
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
/**
 * The source slice a per-claim audit reads: the full transcript when it fits,
 * otherwise the claim's evidence segments with twelve neighbours either side.
 * The pipeline's batched critique (F15) no longer calls this; it is kept for
 * the shadow-synthesis harness under evaluations/native-google.
 */
export function auditSource(source: SourceData, claim: ClaimData) {
  if (
    new TextEncoder().encode(JSON.stringify(source.segments)).length <= 180000
  )
    return { scope: "full transcript", segments: source.segments };
  const indexes = source.segments.flatMap((s, i) =>
    claim.evidence.some((e) => e.segment_id === s.id) ? [i] : [],
  );
  return {
    scope:
      "evidence and 12 neighboring segments either side; cross-video context not inferred",
    segments: source.segments.filter((_, i) =>
      indexes.some((j) => Math.abs(i - j) <= 12),
    ),
  };
}
export function missingRanges(source: SourceData, duration: number) {
  const ranges: { start: number; end: number }[] = [];
  let end = 0;
  for (const s of source.segments
    .slice()
    .sort((a, b) => (a.start_seconds || 0) - (b.start_seconds || 0))) {
    if (s.start_seconds === null || s.end_seconds === null) continue;
    if (s.start_seconds > end + 3)
      ranges.push({ start: end, end: Math.min(s.start_seconds, duration) });
    end = Math.max(end, s.end_seconds);
  }
  if (end < duration - 3) ranges.push({ start: end, end: duration });
  return ranges.filter((r) => r.end > r.start);
}
