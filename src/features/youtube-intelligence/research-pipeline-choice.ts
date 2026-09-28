import { z } from "zod";

export const ResearchPipelineSetting = z.enum(["current", "targeted-experimental", "faithful"]);
export type ResearchPipelineSetting = z.infer<typeof ResearchPipelineSetting>;

export const RESEARCH_PIPELINES = [
  { value: "current", label: "Current — full repeated audit", description: "The default research path. Checks statements and evidence coverage, then repeats coverage checks after repair." },
  { value: "faithful", label: "v3 — faithful brief", description: "Builds the brief from the transcript only and checks every statement against the quotes it cites, in parallel. No repeated coverage audit; gaps are listed. Web research is a separate news review. Candidate default pending the LeapEdge comparison." },
  { value: "targeted-experimental", label: "Experimental — targeted audit", description: "Tests reuse of unchanged coverage checks after repair. Changed or uncertain dependencies are checked again. Quality parity and speed or cost gains have not been established." },
] as const;

export const ResearchPipelineIdentity = z.discriminatedUnion("pipeline", [
  z.object({ pipeline: z.literal("current"), version: z.literal("current-v1") }),
  z.object({ pipeline: z.literal("targeted-experimental"), version: z.literal("targeted-experimental-v1") }),
  z.object({ pipeline: z.literal("faithful"), version: z.literal("faithful-v1") }),
]);
export function researchPipelineIdentity(value: unknown = "current"): z.infer<typeof ResearchPipelineIdentity> {
  const pipeline = ResearchPipelineSetting.parse(value);
  if (pipeline === "current") return { pipeline, version: "current-v1" };
  if (pipeline === "faithful") return { pipeline, version: "faithful-v1" };
  return { pipeline, version: "targeted-experimental-v1" };
}

/** Display retained identity only; never substitute today's workspace preference. */
export function researchPipelineLabel(identity: unknown): string {
  if (identity === undefined) return "Current — legacy run (pipeline version not recorded)";
  const parsed = ResearchPipelineIdentity.safeParse(identity);
  if (!parsed.success) return "Pipeline identity unavailable — inspect retained run configuration";
  return `${RESEARCH_PIPELINES.find(item => item.value === parsed.data.pipeline)!.label} · ${parsed.data.version}`;
}

/** Resolve only frozen run input. Explicit malformed identities fail closed. */
export function researchPipelineIdentityFromInput(input: Record<string, unknown>): z.infer<typeof ResearchPipelineIdentity> {
  const nested = input.researchPipelineIdentity === undefined ? undefined : ResearchPipelineIdentity.parse(input.researchPipelineIdentity);
  const flat = input.researchPipeline === undefined && input.researchPipelineVersion === undefined
    ? undefined
    : ResearchPipelineIdentity.parse({ pipeline: input.researchPipeline, version: input.researchPipelineVersion });
  if (nested && flat && (nested.pipeline !== flat.pipeline || nested.version !== flat.version)) {
    throw new Error("Conflicting frozen research pipeline identities");
  }
  if (nested || flat) return (nested ?? flat)!;
  const snapshot = z.object({ processing: z.object({ researchPipeline: ResearchPipelineSetting.optional() }).optional() }).safeParse(input.teamPreferencesSnapshot);
  // Historical inputs predate pipeline selection; never consult live preferences.
  if (input.teamPreferencesSnapshot !== undefined && !snapshot.success) {
    throw new Error("Invalid frozen team preferences for research pipeline");
  }
  return researchPipelineIdentity(snapshot.success ? snapshot.data.processing?.researchPipeline : undefined);
}

/** Read presentation never invents a version or lets one malformed row break a page. */
export function researchPipelineIdentityForDisplay(input: Record<string, unknown>): z.infer<typeof ResearchPipelineIdentity> | null | undefined {
  if (input.researchPipelineIdentity === undefined && input.researchPipeline === undefined && input.researchPipelineVersion === undefined) return undefined;
  try {
    return researchPipelineIdentityFromInput(input);
  } catch {
    return null;
  }
}

export function researchPipelineLabelFromInput(input: Record<string, unknown>): string {
  return researchPipelineLabel(researchPipelineIdentityForDisplay(input));
}
