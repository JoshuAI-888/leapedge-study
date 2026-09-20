import { z } from "zod";

/** Freeze rollout switches at admission so restarting a worker cannot change
 * the treatment of an already queued analysis or its paid-call identity. */
export function freezeEfficiency(
  input: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
) {
  if (input.task) return input;
  const profile = z.enum(["off", "conservative", "experimental-overlap"])
    .parse(env.YTI_EFFICIENCY_PROFILE ?? "off");
  if (profile === "off") return input;
  return {
    efficiencyVersion: "evidence-efficiency.v1",
    reuseResearchCache: true,
    speculativeResearch: profile === "experimental-overlap",
    ...input,
  };
}
