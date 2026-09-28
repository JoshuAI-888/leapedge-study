import { z } from "zod";
import type {
  AnalysisContextData,
  ExternalEvidenceData,
} from "./research-brief.ts";

/**
 * An analyst-requested review of a brief's claims against dated news. The
 * default brief is built from the transcript alone; this is the only place web
 * sources enter. Every statement must cite retrieved articles with verbatim
 * excerpts, and every citation is checked here, deterministically, before an
 * independent model check. Nothing here judges whether the creator was right
 * beyond what the cited articles say.
 */
export const NewsCitation = z.object({
  sourceId: z.string().min(1).max(80),
  excerpt: z.string().min(1).max(1200),
});
export const NewsStatement = z.object({
  text: z.string().min(1).max(1200),
  citations: z.array(NewsCitation).max(6),
});
export const NEWS_VERDICTS = [
  "consistent",
  "contradicted",
  "mixed",
  "superseded",
  "not_covered",
] as const;
export const NewsReviewDraft = z.object({
  summary: z.array(NewsStatement).max(6),
  claims: z
    .array(
      z.object({
        claimId: z.string().min(1).max(80),
        verdict: z.enum(NEWS_VERDICTS),
        asOfVideo: z.array(NewsStatement).max(6),
        sinceVideo: z.array(NewsStatement).max(6),
      }),
    )
    .max(48),
  gaps: z.array(z.string().max(500)).max(20),
});
export type NewsReviewDraftData = z.infer<typeof NewsReviewDraft>;

export const NewsPlan = z.object({
  queries: z
    .array(
      z.object({
        query: z.string().min(5).max(400),
        claimIds: z.array(z.string()).min(1).max(12),
        reason: z.string().max(500),
      }),
    )
    .max(6),
});

export const NewsCheck = z.object({
  verdicts: z.array(
    z.object({
      id: z.string(),
      supported: z.boolean(),
      reason: z.string().min(1).max(600),
    }),
  ),
});

export type NewsSection = "summary" | "asOfVideo" | "sinceVideo";
export type CheckedStatement = z.infer<typeof NewsStatement> & {
  id: string;
  section: NewsSection;
  claimId: string | null;
};
export type RejectedStatement = CheckedStatement & { reasons: string[] };

const squash = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** A source may support a statement about the video date only if it was
 * published by then, and a development since the video only if later. An
 * undated source can be cited for neither. */
export function sourceWindow(
  source: Pick<ExternalEvidenceData, "publishedAt">,
  context: Pick<AnalysisContextData, "recordedAt" | "videoPublishedAt">,
): "asOfVideo" | "sinceVideo" | "undated" {
  const cutoff = context.recordedAt ?? context.videoPublishedAt;
  if (!source.publishedAt || !cutoff) return "undated";
  return Date.parse(source.publishedAt) <= Date.parse(cutoff)
    ? "asOfVideo"
    : "sinceVideo";
}

/**
 * Structural checks with no model: known claim IDs, at least one citation per
 * statement, citations to retrieved sources only, excerpts that appear verbatim
 * in the cited article, and dates on the correct side of the video. A verdict
 * other than not_covered with no surviving statement is downgraded.
 */
export function validateNewsReview(
  draft: NewsReviewDraftData,
  sources: ExternalEvidenceData[],
  claimIds: string[],
  context: Pick<AnalysisContextData, "recordedAt" | "videoPublishedAt">,
) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const known = new Set(claimIds);
  const accepted: CheckedStatement[] = [];
  const rejected: RejectedStatement[] = [];
  const check = (
    statement: z.infer<typeof NewsStatement>,
    section: NewsSection,
    claimId: string | null,
    id: string,
  ) => {
    const reasons: string[] = [];
    if (!statement.citations.length) reasons.push("No citation.");
    for (const citation of statement.citations) {
      const source = byId.get(citation.sourceId);
      if (!source) {
        reasons.push(`Cites ${citation.sourceId}, which was not retrieved.`);
        continue;
      }
      if (squash(citation.excerpt).length < 12)
        reasons.push(`Excerpt from ${citation.sourceId} is too short to verify.`);
      else if (!squash(source.text).includes(squash(citation.excerpt)))
        reasons.push(`Excerpt is not verbatim in ${citation.sourceId}.`);
      const window = sourceWindow(source, context);
      if (section !== "summary" && window !== section)
        reasons.push(
          window === "undated"
            ? `${citation.sourceId} has no publication date.`
            : `${citation.sourceId} was published ${window === "asOfVideo" ? "before" : "after"} the video; it cannot support this section.`,
        );
      if (section === "summary" && window === "undated")
        reasons.push(`${citation.sourceId} has no publication date.`);
    }
    const item = { ...statement, id, section, claimId };
    if (reasons.length) rejected.push({ ...item, reasons });
    else accepted.push(item);
  };
  draft.summary.forEach((s, i) => check(s, "summary", null, `summary-${i + 1}`));
  const claims = draft.claims.flatMap((claim) => {
    if (!known.has(claim.claimId)) {
      for (const [i, s] of [...claim.asOfVideo, ...claim.sinceVideo].entries())
        rejected.push({
          ...s,
          id: `${claim.claimId}-unknown-${i + 1}`,
          section: "asOfVideo",
          claimId: claim.claimId,
          reasons: ["Refers to a claim that is not in this brief."],
        });
      return [];
    }
    claim.asOfVideo.forEach((s, i) =>
      check(s, "asOfVideo", claim.claimId, `${claim.claimId}-asof-${i + 1}`),
    );
    claim.sinceVideo.forEach((s, i) =>
      check(s, "sinceVideo", claim.claimId, `${claim.claimId}-since-${i + 1}`),
    );
    return [{ claimId: claim.claimId, verdict: claim.verdict }];
  });
  return { accepted, rejected, claims };
}

/** Apply the independent check and settle each claim's verdict from what
 * survived. */
export function finalizeNewsReview(
  structural: ReturnType<typeof validateNewsReview>,
  check: z.infer<typeof NewsCheck> | null,
) {
  const verdicts = new Map(check?.verdicts.map((v) => [v.id, v]) ?? []);
  const accepted: CheckedStatement[] = [];
  const rejected = [...structural.rejected];
  for (const statement of structural.accepted) {
    const verdict = verdicts.get(statement.id);
    if (!check) accepted.push(statement);
    else if (!verdict)
      rejected.push({ ...statement, reasons: ["Independent check returned no verdict."] });
    else if (!verdict.supported)
      rejected.push({ ...statement, reasons: [`Independent check: ${verdict.reason}`] });
    else accepted.push(statement);
  }
  const claims = structural.claims.map((claim) => {
    const kept = accepted.filter((s) => s.claimId === claim.claimId);
    const verdict =
      claim.verdict !== "not_covered" && !kept.length ? "not_covered" : claim.verdict;
    return {
      claimId: claim.claimId,
      verdict,
      downgraded: verdict !== claim.verdict,
      asOfVideo: kept.filter((s) => s.section === "asOfVideo"),
      sinceVideo: kept.filter((s) => s.section === "sinceVideo"),
    };
  });
  return {
    summary: accepted.filter((s) => s.section === "summary"),
    claims,
    rejected,
    independentlyChecked: check !== null,
  };
}

export type NewsReviewData = ReturnType<typeof finalizeNewsReview> & {
  id: string;
  runId: string;
  briefId: string;
  videoId: string;
  createdAt: string;
  cutoff: string | null;
  sources: (Pick<
    ExternalEvidenceData,
    "id" | "url" | "title" | "publishedAt" | "publicationConfirmed" | "sourceClass" | "query"
  > & { window: ReturnType<typeof sourceWindow> })[];
  gaps: string[];
  queries: z.infer<typeof NewsPlan>["queries"];
  searchCostUsd: number;
};
