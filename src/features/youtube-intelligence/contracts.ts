import { z } from "zod";
export const MODELS = [
  "google/gemini-3.8-flash",
  "google/gemini-3.5-flash",
  "google/gemini-3.1-pro-preview",
] as const;
export const Segment = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  start_seconds: z.number().nonnegative().nullable(),
  end_seconds: z.number().nonnegative().nullable(),
});
export const Source = z
  .object({
    video_id: z.string().optional(),
    language: z.string().optional(),
    source_kind: z.string().default("imported_transcript"),
    segments: z.array(Segment).min(1).max(20000),
  })
  .superRefine((s, c) => {
    const ids = new Set();
    for (const x of s.segments) {
      if (
        ids.has(x.id) ||
        (x.start_seconds !== null &&
          x.end_seconds !== null &&
          x.end_seconds < x.start_seconds)
      )
        c.addIssue({
          code: "custom",
          message: "Duplicate segment ID or reversed timestamp",
        });
      ids.add(x.id);
    }
  });
export const Claim = z.object({
  thesis_en: z.string().min(1),
  instrument_as_spoken: z.string().nullable(),
  ticker: z.string().nullable(),
  ticker_explicit: z.boolean(),
  stance: z.enum([
    "long",
    "short",
    "neutral",
    "avoid",
    "watch",
    "hold",
    "conditional",
  ]),
  horizon_en: z.string().nullable(),
  conditions_en: z.array(z.string()),
  creator_conviction: z.enum(["high", "medium", "low", "unspecified"]),
  risks_en: z.array(z.string()),
  levels: z.array(
    z.object({
      kind: z.enum(["entry", "target", "stop", "support", "resistance"]),
      value_original: z.string(),
    }),
  ),
  evidence: z
    .array(
      z.object({
        segment_id: z.string(),
        end_segment_id: z.string().optional(),
        quote_original: z.string().min(1),
        quote_translation_en: z.string(),
      }),
    )
    .min(1),
});
export type SourceData = z.infer<typeof Source>;
export type ClaimData = z.infer<typeof Claim>;
export type CheckedClaim = {
  id: string;
  claim: ClaimData;
  passed: boolean;
  reasons: string[];
  audit?: { verdict: string; reason_en: string };
};
export type Run = {
  id: string;
  videoId: string;
  url: string;
  model: string;
  promptVersion: string;
  title: string;
  status: string;
  stage: string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  cost: number;
};
export function videoId(raw: string) {
  const u = new URL(raw);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw Error("Use a public YouTube video URL.");
  const h = u.hostname.toLowerCase();
  let id = "";
  if (h === "youtu.be") id = u.pathname.slice(1);
  else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(h))
    id =
      u.pathname === "/watch"
        ? u.searchParams.get("v") || ""
        : /^\/(shorts|live|embed)\/([^/]+)$/.exec(u.pathname)?.[2] || "";
  if (!/^[\w-]{11}$/.test(id)) throw Error("Use a valid YouTube video URL.");
  return id;
}
export function validateClaim(claim: ClaimData, source: SourceData) {
  const reasons: string[] = [];
  const quotes: string[] = [];
  for (const e of claim.evidence) {
    const start = source.segments.findIndex((s) => s.id === e.segment_id),
      end = e.end_segment_id
        ? source.segments.findIndex((s) => s.id === e.end_segment_id)
        : start;
    const text =
      start >= 0 && end >= start && end - start < 12
        ? source.segments
            .slice(start, end + 1)
            .map((s) => s.text)
            .join("")
        : "";
    const offset = text.indexOf(e.quote_original);
    if (offset < 0 || offset >= (source.segments[start]?.text.length || 0))
      reasons.push("Quote does not match the retained source.");
    quotes.push(e.quote_original);
  }
  for (const l of claim.levels)
    if (
      !quotes.some((q) =>
        new RegExp(
          `(?<![0-9])(?<![0-9][.,])${l.value_original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9]|[.,][0-9])`,
        ).test(q),
      )
    )
      reasons.push("Price is not present verbatim in its evidence.");
  if (
    claim.ticker &&
    (!claim.ticker_explicit ||
      !quotes.some((q) =>
        new RegExp(
          `(^|[^A-Za-z0-9])${claim.ticker!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`,
          "i",
        ).test(q),
      ))
  )
    reasons.push("Ticker is not explicit in its evidence.");
  return reasons;
}
export function coverage(source: SourceData, duration: number) {
  const spans = source.segments
    .filter((s) => s.start_seconds !== null && s.end_seconds !== null)
    .map((s) => [s.start_seconds!, Math.min(duration, s.end_seconds!)])
    .sort((a, b) => a[0] - b[0]);
  let covered = 0,
    end = 0;
  for (const [a, b] of spans) {
    if (b > a) {
      covered += Math.max(0, b - Math.max(a, end));
      end = Math.max(end, b);
    }
  }
  const ratio = duration > 0 ? covered / duration : 0;
  return {
    ratio,
    coveredSeconds: covered,
    durationSeconds: duration,
    status:
      ratio >= 0.9 ? "timestamps_cover_most_video" : "incomplete_or_unknown",
    audioVerified: false,
  };
}

export function anchorClaimEvidence(
  claim: ClaimData,
  source: SourceData,
): ClaimData {
  return {
    ...claim,
    evidence: claim.evidence.map((e) => {
      if (e.end_segment_id) return e;
      const start = source.segments.findIndex((s) => s.id === e.segment_id);
      if (start < 0 || source.segments[start].text.includes(e.quote_original))
        return e;
      let text = source.segments[start].text;
      for (
        let end = start + 1;
        end < Math.min(source.segments.length, start + 12);
        end++
      ) {
        text += source.segments[end].text;
        const offset = text.indexOf(e.quote_original);
        if (offset >= 0 && offset < source.segments[start].text.length)
          return { ...e, end_segment_id: source.segments[end].id };
      }
      return e;
    }),
  };
}
