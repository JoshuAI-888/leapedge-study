import type { ClaimData } from "./contracts.ts";
export function levelQualifierIssues(claim: ClaimData) {
  const reasons: string[] = [];
  for (const level of claim.levels) {
    if (level.kind !== "entry") continue;
    const value = level.value_original.trim();
    if (!/^\$?\d+(?:[.,]\d+)*$/.test(value)) continue;
    const number = value
      .replace(/^\$/, "")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `\\b(under|below|above|over|less than|more than|at least|at most)\\s*\\$?${number}(?![\\d]|[.,][\\d])`,
      "i",
    );
    if (claim.evidence.some((e) => pattern.test(e.quote_original)))
      reasons.push(
        `Level ${value} omits a source comparator; retain the complete original threshold, not an exact entry.`,
      );
  }
  return reasons;
}
