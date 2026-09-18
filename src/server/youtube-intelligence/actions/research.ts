import { z } from "zod";
import * as R from "../research-store.ts";
import { countClaims } from "../repos/claims.ts";
import { countMentions } from "../repos/mentions.ts";
import { reads, writes, nothing, type ActionTable } from "./types.ts";
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
    performances: await R.docs("performance"),
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
export const research: ActionTable = {
  snapshot: reads(nothing, snapshot),
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
