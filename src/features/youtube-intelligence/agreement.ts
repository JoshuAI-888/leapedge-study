import { z } from "zod";
import type { SourceData } from "./contracts.ts";
export const Agreement = z.object({
  agreementScore: z.number().min(0).max(1),
  anchorErrorSeconds: z.number().nonnegative().nullable(),
  agreed: z.boolean(),
  independent: z.boolean().default(true),
  referenceText: z.string(),
  referenceStartSeconds: z.number().nullable(),
  referenceEndSeconds: z.number().nullable(),
  tieBreakSource: z.string().nullable().default(null),
});
export type SpanAgreement = z.infer<typeof Agreement>;
export type TimedText = {
  text: string;
  startSeconds: number | null;
  endSeconds: number | null;
};

function critical(text: string) {
  return (
    text
      .normalize("NFC")
      .toLowerCase()
      .match(
        /[+-]?\d+(?:[.,]\d+)*%?|\b(?:not|never|no|under|above|below|over|buy|sell)\b|不|没|未|高于|低于|买|卖/gu,
      ) ?? []
  ).join("|");
}

/** Match complete contiguous audio cues; no invented word timing or caption-fed ASR. */
export function compareSpan(
  span: TimedText,
  audio: SourceData["segments"],
  threshold = 0.92,
  language: "en" | "zh" = /\p{Script=Han}/u.test(span.text) ? "zh" : "en",
): SpanAgreement {
  const empty: SpanAgreement = {
    agreementScore: 0,
    anchorErrorSeconds: null,
    agreed: false,
    independent: true,
    referenceText: "",
    referenceStartSeconds: null,
    referenceEndSeconds: null,
    tieBreakSource: null,
  };
  const reference = units(span.text, language);
  if (
    !reference.length ||
    span.startSeconds === null ||
    span.endSeconds === null
  )
    return empty;
  const nearby = audio
    .filter(
      (s) =>
        s.start_seconds !== null &&
        s.end_seconds !== null &&
        s.end_seconds >= span.startSeconds! - 30 &&
        s.start_seconds <= span.endSeconds! + 30,
    )
    .slice(0, 160);
  let best = empty;
  for (let start = 0; start < nearby.length; start++) {
    let text = "";
    for (let end = start; end < nearby.length; end++) {
      text += (text && language === "en" ? " " : "") + nearby[end].text;
      const candidate = units(text, language);
      if (candidate.length > reference.length * 2 + 20) break;
      const score = Math.max(
        0,
        1 -
          editCounts(reference, candidate).errors /
            Math.max(reference.length, candidate.length),
      );
      const error = Math.max(
        Math.abs(nearby[start].start_seconds! - span.startSeconds),
        Math.abs(nearby[end].end_seconds! - span.endSeconds),
      );
      if (
        score > best.agreementScore ||
        (score === best.agreementScore &&
          error < (best.anchorErrorSeconds ?? Infinity))
      ) {
        best = {
          ...empty,
          agreementScore: score,
          anchorErrorSeconds: error,
          referenceText: text,
          referenceStartSeconds: nearby[start].start_seconds,
          referenceEndSeconds: nearby[end].end_seconds,
          agreed:
            score >= threshold &&
            error <= 2 &&
            critical(span.text) === critical(text),
        };
      }
    }
  }
  return best;
}

/** Only a pair supporting the retained quote can upgrade that quote. A dissenting caption is not silently replaced. */
export function twoOfThree(
  span: TimedText,
  google: SourceData["segments"],
  whisper: SourceData["segments"],
  threshold = 0.92,
): SpanAgreement {
  const primary = compareSpan(span, google, threshold);
  if (primary.agreed) return primary;
  const tie = compareSpan(span, whisper, threshold);
  return tie.agreed
    ? { ...tie, tieBreakSource: "supadata-generate" }
    : { ...primary, tieBreakSource: "supadata-generate-disagreed" };
}
export function units(text: string, language: "en" | "zh") {
  const normalized = text.normalize("NFC").toLowerCase();
  // Preserve financial punctuation within English tokens: 1.5 must not equal 15.
  if (language === "en")
    return (
      normalized.match(/[+-]?[\p{L}\p{N}]+(?:[.'’%/-][\p{L}\p{N}]+)*%?/gu) || []
    );
  // CER preserves decimal points, percent signs and minus signs. No script conversion.
  return [...normalized].filter((c) => /[\p{L}\p{N}.%+-]/u.test(c));
}

export function editCounts(reference: string[], candidate: string[]) {
  // Two rows keep memory linear in candidate length. Ties prefer fewer insertions/deletions.
  type Cell = {
    errors: number;
    substitutions: number;
    deletions: number;
    insertions: number;
  };
  let row: Cell[] = Array.from({ length: candidate.length + 1 }, (_, i) => ({
    errors: i,
    substitutions: 0,
    deletions: 0,
    insertions: i,
  }));
  for (let i = 1; i <= reference.length; i++) {
    const next: Cell[] = [
      { errors: i, substitutions: 0, deletions: i, insertions: 0 },
    ];
    for (let j = 1; j <= candidate.length; j++) {
      if (reference[i - 1] === candidate[j - 1]) next[j] = row[j - 1];
      else {
        const sub = row[j - 1],
          del = row[j],
          ins = next[j - 1];
        next[j] = [
          {
            ...sub,
            errors: sub.errors + 1,
            substitutions: sub.substitutions + 1,
          },
          { ...del, errors: del.errors + 1, deletions: del.deletions + 1 },
          { ...ins, errors: ins.errors + 1, insertions: ins.insertions + 1 },
        ].sort((a, b) => a.errors - b.errors)[0];
      }
    }
    row = next;
  }
  return row[candidate.length];
}
