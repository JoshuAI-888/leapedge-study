import { z } from "zod";

// References must be independently listened to. Provider consensus is not ground truth.
export const AccuracyCase = z
  .object({
    id: z.string().min(1),
    videoId: z.string().min(1),
    language: z.enum(["en", "zh"]),
    split: z.enum(["development", "held_out"]),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
    reference: z.object({
      status: z.enum(["pending_audio_review", "audio_verified"]),
      text: z.string(),
      reviewer: z.string(),
      reviewedAt: z.string(),
      // Each marker describes a specific occurrence, not merely a word found anywhere.
      criticalFacts: z.array(
        z.object({
          id: z.string().min(1),
          kind: z.enum([
            "issuer",
            "ticker",
            "number",
            "negation",
            "condition",
            "attribution",
          ]),
          expected: z.string().min(1),
        }),
      ),
      anchors: z.array(
        z.object({
          id: z.string().min(1),
          seconds: z.number().nonnegative(),
        }),
      ),
    }),
    candidates: z.array(
      z.object({
        provider: z.string().min(1),
        sourceHash: z.string().min(1),
        text: z.string(),
        // Exact reviewed excerpt; no guessed clipping of a caption cue at a time boundary.
        boundariesReviewed: z.boolean(),
        facts: z.array(
          z.object({
            id: z.string(),
            observed: z.string(),
          }),
        ),
        anchors: z.array(
          z.object({
            id: z.string(),
            seconds: z.number().nonnegative().nullable(),
          }),
        ),
      }),
    ),
  })
  .superRefine((c, ctx) => {
    if (c.endSeconds <= c.startSeconds)
      ctx.addIssue({ code: "custom", message: "Invalid excerpt window" });
    if (
      c.reference.status === "audio_verified" &&
      (!c.reference.text.trim() ||
        !c.reference.reviewer.trim() ||
        !Number.isFinite(Date.parse(c.reference.reviewedAt)))
    )
      ctx.addIssue({
        code: "custom",
        message: "Audio verification requires text, reviewer and review date",
      });
    const groups = [
      c.reference.criticalFacts,
      c.reference.anchors,
      ...c.candidates.flatMap((x) => [x.facts, x.anchors]),
    ];
    for (const group of groups)
      if (new Set(group.map((x) => x.id)).size !== group.length)
        ctx.addIssue({ code: "custom", message: "Duplicate annotation ID" });
    for (const a of c.reference.anchors)
      if (a.seconds < c.startSeconds || a.seconds > c.endSeconds)
        ctx.addIssue({
          code: "custom",
          message: "Reference anchor outside excerpt",
        });
  });

export const ACCURACY_VERSION = "audio-reference.v1";

export {
  units,
  editCounts,
} from "../src/features/youtube-intelligence/agreement.ts";
import {
  units,
  editCounts,
} from "../src/features/youtube-intelligence/agreement.ts";

export function scoreAccuracy(input: unknown) {
  const c = AccuracyCase.parse(input);
  return c.candidates.map((candidate) => {
    const eligible =
      c.reference.status === "audio_verified" && candidate.boundariesReviewed;
    const base = {
      caseId: c.id,
      videoId: c.videoId,
      language: c.language,
      split: c.split,
      provider: candidate.provider,
      sourceHash: candidate.sourceHash,
      version: ACCURACY_VERSION,
    };
    if (!eligible)
      return {
        ...base,
        status: "pending_audio_review" as const,
        metrics: null,
      };
    const reference = units(c.reference.text, c.language);
    const hypothesis = units(candidate.text, c.language);
    if (!reference.length) throw Error("Reference must contain speech units");
    if (reference.length > 5000 || hypothesis.length > 10000)
      throw Error("Use bounded audio excerpts for accuracy scoring");
    const edits = editCounts(reference, hypothesis);
    const facts = c.reference.criticalFacts.map((f) => {
      const observed = candidate.facts.find((x) => x.id === f.id)?.observed;
      return {
        ...f,
        observed: observed ?? null,
        exact:
          observed !== undefined &&
          observed.normalize("NFC") === f.expected.normalize("NFC"),
      };
    });
    const anchors = c.reference.anchors.map((a) => {
      const seconds = candidate.anchors.find((x) => x.id === a.id)?.seconds;
      return {
        id: a.id,
        errorSeconds: seconds == null ? null : Math.abs(seconds - a.seconds),
      };
    });
    const measured = anchors.flatMap((a) =>
      a.errorSeconds === null ? [] : [a.errorSeconds],
    );
    return {
      ...base,
      status: "scored" as const,
      metrics: {
        unit: c.language === "en" ? "word" : "character",
        referenceUnits: reference.length,
        ...edits,
        errorRate: edits.errors / reference.length,
        criticalFacts: {
          total: facts.length,
          exact: facts.filter((f) => f.exact).length,
          details: facts,
        },
        timestamps: {
          total: anchors.length,
          measured: measured.length,
          withinTwoSeconds: measured.filter((x) => x <= 2).length,
          meanAbsoluteErrorSeconds: measured.length
            ? measured.reduce((a, b) => a + b, 0) / measured.length
            : null,
          details: anchors,
        },
      },
    };
  });
}
