/** Historical briefs retain their original audit; the display must not upgrade
 * an old source-level citation into assertion-level factual support. */
export function factualSupportLabel(sentence: {
  factualStatus: "unverified" | "corroborated" | "partial" | "disputed";
  externalSupport?: { relationship: "supports" | "contradicts" }[];
}) {
  if (sentence.factualStatus === "disputed")
    return sentence.externalSupport?.some((support) => support.relationship === "contradicts")
      ? "Disputed · retained contradiction"
      : "Unverified · no retained contradiction support";
  if (sentence.externalSupport?.some((support) => support.relationship === "contradicts"))
    return "Disputed · conflicting retained support";
  if (sentence.factualStatus === "unverified") return "Unverified";
  if (!sentence.externalSupport?.some((support) => support.relationship === "supports"))
    return "Unverified · no retained assertion support";
  return sentence.factualStatus === "partial" ? "Partially corroborated" : "Corroborated · model assessed";
}

export function thesisRobustnessLabel(sentence: {
  robustness: "insufficient" | "fragile" | "supported";
  factualStatus: "unverified" | "corroborated" | "partial" | "disputed";
  externalSupport?: { relationship: "supports" | "contradicts" }[];
}) {
  if (sentence.robustness === "insufficient") return "Not established";
  if (sentence.robustness === "fragile") return "Fragility flagged · model assessed";
  if (sentence.externalSupport?.some((support) => support.relationship === "contradicts"))
    return "Not established · conflicting factual support";
  if (sentence.factualStatus !== "corroborated" || !sentence.externalSupport?.some((support) => support.relationship === "supports"))
    return "Not established · no retained assertion support";
  return "Supported · model assessed";
}
