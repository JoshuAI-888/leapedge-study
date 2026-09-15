import type { Run, CheckedClaim } from "./contracts.ts";
export function researchOutcome(run: Run) {
  if (run.status !== "completed") return run.status.replaceAll("_", " ");
  if (
    !Array.isArray(run.output.claims) &&
    typeof run.output.acceptedEvidenceCount === "number"
  ) {
    return run.output.acceptedEvidenceCount > 0
      ? "Research available · text checked"
      : Number(run.output.rejectedEvidenceCount) > 0
        ? "No verified evidence · review required"
        : "No research extracted · completeness unverified";
  }
  const items = [
    ...((run.output.claims || []) as CheckedClaim[]),
    ...((run.output.keyPoints || []) as CheckedClaim[]),
  ];
  const count = items.filter((x) => x.passed).length;
  return count
    ? count < items.length
      ? "Research available · some evidence rejected"
      : "Research available · text checked"
    : items.length
      ? "No verified evidence · review required"
      : "No research extracted · completeness unverified";
}
export function canDropFailedAudit(run: Run) {
  return (
    run.status === "failed" &&
    run.stage === "critique" &&
    !/budget|quota|401|403|429|key|auth/i.test(run.error || "")
  );
}
