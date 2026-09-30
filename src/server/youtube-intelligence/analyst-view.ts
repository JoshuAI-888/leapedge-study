import { resolveReference } from "./listings/resolve.ts";
import {
  buildAnalystView,
  analystNote,
} from "../../features/youtube-intelligence/analyst-view.ts";
import type { CheckedClaim, MentionData, Run, SourceData } from "../../features/youtube-intelligence/contracts.ts";
import type { ResearchBriefData } from "../../features/youtube-intelligence/research-brief.ts";

/** The analyst view of one analysis run, with listings resolved here on the server. */
export function analystViewFor(run: Run, brief: ResearchBriefData | null) {
  const claims = (run.output.claims ?? []) as CheckedClaim[];
  const mentions = (run.output.mentions ?? []) as MentionData[];
  const source = run.output.source as SourceData | undefined;
  const proposals = new Map(
    ((run.output.tickerProposals ?? []) as { id?: string; proposedTicker?: string }[]).map((p) => [p.id, p.proposedTicker ?? null]),
  );
  const metadata = (run.output.metadata ?? {}) as { channel?: string; publishedAt?: string };
  const view = buildAnalystView({
    title: run.title,
    channel: metadata.channel ?? null,
    publishedAt: metadata.publishedAt ?? null,
    claims,
    mentions,
    mentionChecks: run.output.mentionChecks as Record<string, boolean> | undefined,
    claimListings: Object.fromEntries(
      claims.map((c) => [
        c.id,
        resolveReference(c.claim.instrument_as_spoken ?? c.claim.ticker, c.claim.ticker ?? proposals.get(c.id) ?? null, {
          explicit: c.claim.ticker_explicit,
        }),
      ]),
    ),
    mentionListings: mentions.map((m) => resolveReference(m.instrument_as_spoken, m.ticker)),
    brief,
    segmentSeconds: Object.fromEntries((source?.segments ?? []).map((s) => [s.id, s.start_seconds])),
    transcriptionDoubts: (run.output.transcriptionDoubts ?? []) as { heard: string; likely: string; reason_en: string; start_seconds?: number | null }[],
  });
  return { view, note: analystNote(view) };
}
