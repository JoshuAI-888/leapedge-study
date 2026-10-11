import { AuditedExecutionPlan } from "../../features/youtube-intelligence/audited-execution.ts";
import { z } from "zod";
import { ProcessingProfileSetting } from "../../features/youtube-intelligence/processing-profiles.ts";

/** Freeze flags at admission. Changing workspace or deployment settings cannot
 * change a queued run's treatment or paid-call identity. */
export function freezeEfficiency(
  input: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
  workspaceProfile: unknown = "deployment-default",
) {
  if (input.task) return input;
  const snapshot = z.object({ processing: z.object({ efficiencyProfile: ProcessingProfileSetting.optional(), auditedSpeed:z.boolean().optional(),criticRouting:z.enum(["default","latency","throughput"]).optional() }).optional() })
    .optional().parse(input.teamPreferencesSnapshot);
  const selected = ProcessingProfileSetting.parse(snapshot?.processing?.efficiencyProfile ?? workspaceProfile);
  const profile = selected === "deployment-default"
    ? z.enum(["off", "conservative", "experimental-overlap"]).parse(env.YTI_EFFICIENCY_PROFILE ?? "off")
    : selected;
  if (snapshot?.processing?.auditedSpeed === true && input.auditedExecutionPlan === undefined) input={...input,auditedExecutionPlan:AuditedExecutionPlan.parse({version:"audited-speed.v1",criticRouting:snapshot.processing.criticRouting??"default"}),publicationSafeguardsVersion:"atomic-publication.v1"};
  if (profile === "off" && selected === "deployment-default") return input;
  return {
    efficiencyVersion: profile === "off" ? null : "evidence-efficiency.v1",
    reuseResearchCache: profile !== "off",
    speculativeResearch: profile === "experimental-overlap",
    ...input,
  };
}
