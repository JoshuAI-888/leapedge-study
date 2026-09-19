import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import {
  lockedDoc,
  docs,
  put,
  prompt,
  queue,
  comparison,
} from "./research-store.ts";
import { get, db } from "./store.ts";
import {
  Source,
  type Run,
} from "../../features/youtube-intelligence/contracts.ts";
import { gradeRun, CHECK_VERSION } from "../../../evaluations/checks.ts";
const Spec = z.object({
  baselineId: z.string(),
  hypothesis: z.string().min(10).max(3000),
  variants: z
    .array(
      z.object({
        model: z.string().trim().min(1).max(200),
        criticModel: z.string().trim().min(1).max(200),
        promptVersion: z.string(),
      }),
    )
    .min(2)
    .max(4),
});
export async function startExperiment(input: unknown) {
  const spec = Spec.parse(input);
  const baseline = await get(spec.baselineId);
  if (!baseline || baseline.status !== "completed" || baseline.input.task)
    throw Error("Choose a completed video with retained evidence.");
  const source = Source.parse(baseline.output.source);
  if (
    new Set(spec.variants.map((v) => JSON.stringify(v))).size !==
    spec.variants.length
  )
    throw Error("Choose distinct variants.");
  for (const v of spec.variants) await prompt(v.promptVersion);
  return db().transaction(async () => {
    const id = randomUUID();
    const runs: Run[] = [];
    for (const v of spec.variants)
      runs.push(await queue(baseline.videoId, source, v, true));
    const record = {
      id,
      createdAt: new Date().toISOString(),
      status: "running",
      spec,
      videoId: baseline.videoId,
      sourceHash: createHash("sha256")
        .update(JSON.stringify(source))
        .digest("hex"),
      runIds: runs.map((r) => r.id),
      pipelineVersion: "research.v4.reasoning",
    };
    await put("experiment", id, record);
    return record;
  });
}
export async function finishExperiments() {
  for (const e of await docs<{
    id: string;
    status: string;
    runIds: string[];
    spec: z.infer<typeof Spec>;
    sourceHash: string;
  }>("experiment")) {
    if (e.status !== "running") continue;
    const runs = await Promise.all(e.runIds.map((id) => get(id)));
    if (
      runs.some((r) => !r || ["queued", "running", "held"].includes(r.status))
    )
      continue;
    await db().transaction(async () => {
      // FOR UPDATE on the experiment row: a second caller that reaches the same
      // experiment waits here and then sees it is no longer running.
      if ((await lockedDoc("experiment", e.id))?.status !== "running") return;
      const rows = runs.map((r) => ({
        runId: r!.id,
        videoId: r!.videoId,
        model: r!.model,
        promptVersion: r!.promptVersion,
        originalCostUsd: r!.cost,
        ...gradeRun(r!),
      }));
      const id = `experiment:${e.id}`;
      await put("evaluation", id, {
        id,
        at: new Date().toISOString(),
        checkVersion: CHECK_VERSION,
        mode: "fresh pipeline variants on identical retained source",
        newModelCostUsd: runs.reduce((s, r) => s + (r?.cost || 0), 0),
        rows,
        limitation:
          "Automated retained-text checks; semantic recall and audio fidelity require independent review.",
      });
      const completed = runs.filter((r) => r?.status === "completed") as Run[];
      const comparisons = [];
      for (const r of completed.slice(1))
        comparisons.push(
          await comparison({
            leftId: completed[0].id,
            rightId: r.id,
            hypothesis: e.spec.hypothesis,
          }),
        );
      await put("experiment", e.id, {
        ...e,
        status: rows.every((r) => r.pass) ? "checks_passed" : "needs_review",
        finishedAt: new Date().toISOString(),
        evaluationId: id,
        comparisons,
        rows,
      });
    });
  }
}
