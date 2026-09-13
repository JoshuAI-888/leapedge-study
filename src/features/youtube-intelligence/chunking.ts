import type { SourceData, ClaimData } from "./contracts.ts";
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
      c.ticker,
      c.stance,
      c.horizon_en,
      c.conditions_en,
      c.levels,
      c.evidence.map((e) => [e.segment_id, e.quote_original]).sort(),
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
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
