import { queueResearchBrief, researchBriefs } from "../research-pipeline.ts";
import { queueNewsReview, newsReviews } from "../news-review.ts";
import { z } from "zod";
import { researchReadiness } from "../../../features/youtube-intelligence/research-readiness.ts";
import { seedLists } from "../seed/lists.ts";
import * as R from "../research-store.ts";
import { countClaims } from "../repos/claims.ts";
import { countMentions } from "../repos/mentions.ts";
import type { performance } from "../market.ts";
import { reads, writes, nothing, type ActionTable } from "./types.ts";
import {
  DeleteIdeaInput,
  SavedSinceInput,
  deleteIdea,
  savedSince,
} from "../saved-calls.ts";
/**
 * The snapshot reads claims and mentions under a repo row limit, so it reports
 * what it returned beside what exists. A caller that sees `truncated` knows the
 * list is a window and not the whole record.
 */
async function snapshot() {
  const s = await R.researchSnapshot();
  const [claims, mentions] = await Promise.all([
    countClaims(),
    countMentions(),
  ]);
  return {
    ...s,
    // These collections only back canonical IDs and Lab selectors. Full
    // transcripts, extraction plans and audits remain on the run detail API.
    runs: s.runs.map((run) => ({ ...run, output: {} })),
    evaluationRuns: s.evaluationRuns.map((run) => ({ ...run, output: {} })),
    researchBriefs: (await researchBriefs()).map(
      ({ evidence, external, retrievalNotes, baseline, ...brief }) => ({
        ...brief,
        readiness: researchReadiness({ ...brief, evidence }),
        latestExternalPublishedAt:
          external
            .filter((e) =>
              brief.sentences.some(
                (s) => s.timeMode === "current" && s.externalIds.includes(e.id),
              ),
            )
            .map((e) => e.publishedAt)
            .filter((date): date is string => !!date)
            .sort()
            .at(-1) ?? null,
      }),
    ),
    seedSources: seedLists().map((list) => ({
      source: list.source,
      placeholder: list.placeholder,
      note: list.note,
      count: list.channels.length,
      installedCount: s.channels.filter((channel) =>
        list.channels.some((seed) => seed.id === channel.id),
      ).length,
    })),
    performances:
      await R.docs<Awaited<ReturnType<typeof performance>>>("performance"),
    counts: {
      claims: {
        returned: s.claims.length,
        total: claims,
        truncated: claims > s.claims.length,
      },
      mentions: {
        returned: s.mentions.length,
        total: mentions,
        truncated: mentions > s.mentions.length,
      },
    },
  };
}
/** What the research front end reads, including the truncation counts. */
export type ResearchSnapshot = Awaited<ReturnType<typeof snapshot>>;
export const research: ActionTable = {
  snapshot: reads(nothing, snapshot),
  generateResearchBrief: writes(
    z.strictObject({ sourceRunId: z.string().min(1) }),
    (v) => queueResearchBrief(v.sourceRunId),
  ),
  // Web research is analyst-requested only: a cited review of a brief's claims
  // against dated news. The default brief never searches the web.
  requestNewsReview: writes(
    z.strictObject({ briefId: z.string().min(1) }),
    (v) => queueNewsReview(v.briefId),
  ),
  newsReviews: reads(nothing, () => newsReviews()),
  saveIdea: writes(
    z.strictObject({ runId: z.string(), claimId: z.string() }),
    (v) => R.saveIdea(v.runId, v.claimId),
  ),
  idea: writes(
    z.strictObject({
      id: z.string(),
      status: z.enum(["open", "done", "dismissed"]),
      note: z.string().max(4000).default(""),
    }),
    (v) => R.changeIdea(v),
  ),
  // F75: permanent delete, only for a call already in Removed.
  deleteIdea: writes(DeleteIdeaInput, (v) => deleteIdea(v.id)),
  // F75: "since saved" price moves from the stored prices table.
  savedSince: reads(SavedSinceInput, (v) => savedSince(v.calls)),
  watch: writes(
    z.strictObject({
      ticker: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9.^=-]{1,20}$/),
      enabled: z.boolean(),
    }),
    (v) => R.watch(v),
  ),
  comparison: writes(
    z.strictObject({
      leftId: z.string(),
      rightId: z.string(),
      hypothesis: z.string().min(5).max(4000),
    }),
    (v) => R.comparison(v),
  ),
  review: writes(
    z.strictObject({
      comparisonId: z.string(),
      winner: z.enum(["left", "right", "tie", "inconclusive"]),
      accuracy: z.number().min(0).max(5),
      completeness: z.number().min(0).max(5),
      evidence: z.number().min(0).max(5),
      notes: z.string().min(20).max(12000),
      reviewer: z.string().min(1).max(100),
    }),
    (v) => R.review(v),
  ),
  improvement: writes(
    z.strictObject({
      title: z.string().min(5).max(200),
      problem: z.string().min(10).max(5000),
      proposal: z.string().min(10).max(5000),
      outcome: z.string().max(5000).default("Not yet tested"),
      comparisonId: z.string().optional(),
      status: z.enum(["proposed", "testing", "accepted", "rejected"]),
    }),
    (v) => R.improvement(v),
  ),
};
