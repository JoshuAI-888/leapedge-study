import { createHash } from "node:crypto";
import { z } from "zod";
import { Claim, type Run, type CheckedClaim } from "../../features/youtube-intelligence/contracts.ts";
import { AnalysisContext, EvidenceRecord, analysisContext, evidenceInventory } from "../../features/youtube-intelligence/research-brief.ts";
import { TeamPreferences, type TeamPreferencesData } from "../../features/youtube-intelligence/settings.ts";
import { doc, put, putIfAbsent, runTeamPreferences } from "./research-store.ts";
import { researchStep } from "./research-pipeline.ts";
import { RetrievalRecordSchema } from "./research-sources.ts";

const VERSION = "research-prefetch.v1";
const Snapshot = z.object({
  sourceRunId: z.string(), title: z.string(), context: AnalysisContext,
  evidence: z.array(EvidenceRecord), teamPreferencesSnapshot: TeamPreferences,
  operationalInput: z.record(z.string(), z.unknown()),
});
const Progress = z.object({
  version: z.literal(VERSION),
  state: z.enum(["running", "complete", "failed", "skipped"]),
  stage: z.string(), output: z.record(z.string(), z.unknown()),
  startedAt: z.iso.datetime(), completedAt: z.iso.datetime().optional(),
  diagnostic: z.string().optional(),
});
const Candidate = z.object({ id: z.string(), claim: Claim, reasons: z.array(z.string()).optional(), audit: z.object({ verdict: z.string() }).optional() });

/** Provisional candidates are query-planning data only, never accepted evidence. */
function candidateSnapshot(run: Run, settings: TeamPreferencesData) {
  const shadow = structuredClone(run);
  for (const kind of ["claims", "keyPoints"] as const) {
    shadow.output[kind] = (Array.isArray(run.output[kind]) ? run.output[kind] as unknown[] : []).flatMap(raw => {
      const parsed = Candidate.safeParse(raw);
      if (!parsed.success || parsed.data.reasons?.length || parsed.data.audit?.verdict === "reject") return [];
      return [{ id: parsed.data.id, claim: parsed.data.claim, passed: true, reasons: [] } satisfies CheckedClaim];
    });
  }
  return Snapshot.parse({ sourceRunId: run.id, title: run.title,
    context: { ...analysisContext(run), analysedAt: run.createdAt }, evidence: evidenceInventory(shadow), teamPreferencesSnapshot: settings,
    operationalInput: structuredClone(run.input),
  });
}

/** Caller must await this alongside critique; no worker or background promise is spawned. */
export async function prefetchResearch(run: Run): Promise<void> {
  if (run.input.speculativeResearch !== true) return;
  const key = `${run.id}:${VERSION}`;
  try {
    let retained = await doc("researchPrefetchProgress", key);
    if (retained) {
      const previous = Progress.parse(retained);
      if (previous.state !== "running") { run.output.researchPrefetch = { ...previous, snapshotKey: key, provisional: true }; return; }
    }
    let snapshot = await doc("researchPrefetchSnapshot", key);
    if (!snapshot) {
      await putIfAbsent("researchPrefetchSnapshot", key, candidateSnapshot(run, await runTeamPreferences(run)));
      snapshot = await doc("researchPrefetchSnapshot", key);
    }
    const parsedSnapshot = Snapshot.parse(snapshot);
    const settings = parsedSnapshot.teamPreferencesSnapshot;
    const progress = retained ? Progress.parse(retained) : Progress.parse({ version: VERSION, state: parsedSnapshot.evidence.length ? "running" : "skipped", stage: "metadata", output: { researchBaseline: [] }, startedAt: new Date().toISOString() });
    if (parsedSnapshot.operationalInput.processingMode === "batch") {
      progress.state = "skipped";
      progress.diagnostic = "Speculative overlap is restricted to immediate processing.";
    }
    const shadow: Run = { ...structuredClone(run), model: settings.models.extraction.id,
      input: { ...structuredClone(parsedSnapshot.operationalInput), task: "research-brief", snapshot: parsedSnapshot, teamPreferencesSnapshot: settings },
      output: progress.output, stage: progress.stage,
    };
    await put("researchPrefetchProgress", key, progress);
    while (progress.state === "running" && ["metadata", "research-sources"].includes(shadow.stage)) {
      await researchStep(shadow);
      progress.stage = shadow.stage;
      progress.output = shadow.output;
      await put("researchPrefetchProgress", key, progress);
    }
    if (progress.state === "running") progress.state = "complete";
    progress.completedAt = new Date().toISOString();
    await put("researchPrefetchProgress", key, progress);
    run.output.researchPrefetch = { ...progress, snapshotKey: key, provisional: true };
  } catch (error) {
    const previous = await doc("researchPrefetchProgress", key).catch(() => null);
    const progress = Progress.parse({ version: VERSION, state: "failed", stage: "prefetch", output: previous?.output ?? {}, startedAt: previous?.startedAt ?? new Date().toISOString(), completedAt: new Date().toISOString(), diagnostic: error instanceof Error ? error.message : String(error) });
    // Failure diagnostics never change the parent's acceptance or failure state.
    run.output.researchPrefetch = progress;
    await put("researchPrefetchProgress", key, progress).catch(() => undefined);
  }
}

const RetrievalIdentity = z.object({
  runId: z.string().min(1), query: z.string().min(1).max(400),
  timeMode: z.enum(["video_date", "current"]), cutoff: z.iso.datetime(),
  primaryDomains: z.array(z.string().regex(/^[a-z0-9.-]+$/)).max(100),
});
/**
 * Read only, exact-match bridge from final planning to a provisional request.
 * Unknown outcomes are returned too: callers must use them instead of rebuying.
 * Keep the returned donor provenance beside the consumer's retrieval record.
 */
export async function retainedPrefetchRetrieval(input: z.infer<typeof RetrievalIdentity>) {
  const identity = RetrievalIdentity.parse(input);
  const key = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  const raw = await doc("researchRetrieval", key);
  if (!raw) return null;
  const donor = RetrievalRecordSchema.parse(raw);
  if (donor.state === "complete") {
    const age = donor.completedAt ? Date.now() - Date.parse(donor.completedAt) : Infinity;
    const ttl = identity.timeMode === "current" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    if (age < 0 || age > ttl) return null;
  }
  return {
    donorRunId: identity.runId, donorKey: key, donorCostUsd: donor.costUsd,
    record: { ...donor, costUsd: 0,
      costBasis: `No consumer request; original ${donor.state} outcome and charge belong to donor ${identity.runId}, retrieval ${key}`,
      note: `${donor.note} Reused exact provisional request; no additional provider request was made.`,
    },
  };
}
