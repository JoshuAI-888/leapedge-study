import { createHash } from "node:crypto";
import { z } from "zod";
import { create, db, list } from "./store.ts";
import { docs, putIfAbsent, runTeamPreferences, teamPreferences } from "./research-store.ts";
import { modelCall } from "./pipeline.ts";
import { faithfulAudit } from "./faithful-audit.ts";
import { readEnv } from "./env.ts";
import { screenSentences } from "./jev.ts";
import {
  COMPARISON_CAVEAT,
  ScreenedSentence,
  summariseComparison,
  type JevComparisonData,
} from "../../features/youtube-intelligence/faithfulness-prescreen.ts";
import type { ResearchBriefData, ResearchSentenceData } from "../../features/youtube-intelligence/research-brief.ts";
import type { Run } from "../../features/youtube-intelligence/contracts.ts";

/**
 * Ad hoc Jev vs LLM comparison on one research brief. Both judges read every
 * sentence of the brief (published and withheld) against the quotes it cites:
 * Jev with the tuned question set, the LLM critic with the v3 faithfulness
 * prompt. Nothing is published or changed; the result is a separate document.
 * Each paid call goes through the ledger under this run's id.
 */
export const JEV_COMPARISON_VERSION = "jev-comparison.v1";
const STAGE_JEV = "compare-prescreen-jev";

const Input = z.object({
  task: z.literal("jev-comparison"),
  briefId: z.string().min(1),
});

function briefSentences(brief: ResearchBriefData): ResearchSentenceData[] {
  const seen = new Set<string>();
  return [...brief.sentences, ...brief.rejected.map((r) => r.sentence)].filter((s) =>
    seen.has(s.id) ? false : (seen.add(s.id), true),
  );
}

export async function queueJevComparison(briefId: string, criticModel?: string) {
  const id = z.string().min(1).parse(briefId);
  if (!readEnv().TYPESAFE_API_KEY)
    throw Error("TYPESAFE_API_KEY is not set on the server, so Jev cannot be called. Add it to the environment and try again.");
  const brief = (await docs<ResearchBriefData>("researchBrief")).find((b) => b.id === id);
  if (!brief) throw Error("Research brief not found.");
  if (!briefSentences(brief).length) throw Error("This brief has no sentences to compare.");
  const active = (await list()).find(
    (r) => r.input.task === "jev-comparison" && r.input.briefId === id && ["queued", "running"].includes(r.status),
  );
  if (active) return active;
  const team = await teamPreferences();
  const model = criticModel?.trim() || team.models.critique.id;
  return create(
    brief.videoId,
    team.models.extraction.id,
    {
      task: "jev-comparison",
      briefId: id,
      teamPreferencesSnapshot: { ...team, models: { ...team.models, critique: { ...team.models.critique, id: model } } },
      pipelineVersion: JEV_COMPARISON_VERSION,
    },
    team.prompts.version,
  );
}

export async function jevComparisons(briefId?: string) {
  const all = await docs<JevComparisonData>("jevComparison");
  return briefId ? all.filter((c) => c.briefId === briefId) : all;
}

export async function jevComparisonStep(run: Run) {
  const input = Input.parse(run.input);
  const settings = await runTeamPreferences(run);
  const brief = (await docs<ResearchBriefData>("researchBrief")).find((b) => b.id === input.briefId);
  if (!brief) throw Error("Research brief not found.");
  const sentences = briefSentences(brief);
  const screen = settings.faithfulnessPreScreen;

  if (run.stage === "metadata") {
    run.title = `Jev vs critic · ${brief.title}`;
    run.stage = "compare-jev";
    return;
  }
  if (run.stage === "compare-jev") {
    const result = await screenSentences({
      runId: run.id, stage: STAGE_JEV, sentences, evidence: brief.evidence,
      model: screen.model, band: screen, perVideoCapUsd: settings.budget.perVideoMaxUsd,
    });
    // Nothing to compare against; do not spend on the critic.
    if (!result.results.length) throw Error(result.error ?? "Jev returned no answers.");
    run.output.jevScreen = result;
    run.stage = "compare-critic";
    return;
  }
  if (run.stage === "compare-critic") {
    const invoke = async (stage: string, instructions: string, payload: unknown, schema: z.ZodType) => {
      const responseSchema = z.toJSONSchema(schema);
      const model = settings.models.critique.id;
      const hash = createHash("sha256")
        .update(JSON.stringify({ stage, model, instructions, payload, responseSchema, version: JEV_COMPARISON_VERSION }))
        .digest("hex");
      await putIfAbsent("researchRequest", `${run.id}:${stage}:${hash}`, {
        runId: run.id, stage, model, prompt: instructions, payload, responseSchema, version: JEV_COMPARISON_VERSION, hash,
      });
      return modelCall(run, stage, model, instructions, payload, false, {
        settings, responseSchema, maxOutputTokens: 16000, reasoningEffort: "low",
      });
    };
    const started = Date.now();
    const checked = await faithfulAudit({ sentences, evidence: brief.evidence, invoke });
    const criticWallMs = Date.now() - started;
    const jev = z
      .object({ model: z.string(), results: z.array(ScreenedSentence), wallMs: z.number(), costUsd: z.number(), error: z.string().nullable() })
      .parse(run.output.jevScreen);
    const jevById = new Map(jev.results.map((r) => [r.id, r]));
    const criticById = new Map(checked.verdicts.map((v) => [v.id, v]));
    const rows = sentences.map((s) => {
      const verdict = criticById.get(s.id);
      const unavailable = verdict && /withheld, not disproven/.test(verdict.reason);
      return {
        id: s.id,
        text: s.text,
        jev: jevById.get(s.id) ?? null,
        critic: verdict && !unavailable ? { accepted: verdict.accepted, reason: verdict.reason } : null,
      };
    });
    const criticCost = Number(
      (
        (await (await db())
          .prepare("SELECT COALESCE(SUM(amount),0) AS cost FROM yi_calls WHERE run_id=$1 AND stage LIKE 'critique-%' AND status='completed'")
          .get(run.id)) as { cost: number } | undefined
      )?.cost ?? 0,
    );
    const comparison: JevComparisonData = {
      id: run.id,
      runId: run.id,
      briefId: brief.id,
      briefTitle: brief.title,
      createdAt: new Date().toISOString(),
      jevModel: jev.model,
      criticModel: settings.models.critique.id,
      band: { acceptAtOrAbove: screen.acceptAtOrAbove, rejectAtOrBelow: screen.rejectAtOrBelow },
      rows,
      summary: summariseComparison(rows),
      jev: { wallMs: jev.wallMs, costUsd: jev.costUsd, error: jev.error },
      critic: { wallMs: criticWallMs, costUsd: criticCost, calls: checked.chunks, failures: checked.failures },
      caveat: COMPARISON_CAVEAT,
    };
    await putIfAbsent("jevComparison", run.id, comparison);
    run.output.jevComparisonId = run.id;
    run.status = checked.failures ? "needs_review" : "completed";
    run.stage = "complete";
    return;
  }
  throw Error("Unknown comparison stage.");
}
