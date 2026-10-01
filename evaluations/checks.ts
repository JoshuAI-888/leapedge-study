import {
  Source,
  Claim,
  validateClaim,
  type CheckedClaim,
  type Run,
} from "../src/features/youtube-intelligence/contracts.ts";
export const CHECK_VERSION = "research-regression.v3";
export function gradeRun(run: Run) {
  const failures: string[] = [];
  const claims = (run.output.claims || []) as CheckedClaim[],
    points = (run.output.keyPoints || []) as CheckedClaim[];
  if (run.status !== "completed") failures.push("Analysis is not completed.");
  const source = Source.safeParse(run.output.source);
  if (!source.success) failures.push("Retained source missing or invalid.");
  if (source.success)
    for (const c of [...claims, ...points].filter((c) => c.passed)) {
      const parsed = Claim.safeParse(c.claim);
      if (!parsed.success) {
        failures.push(`${c.id}: invalid claim schema`);
        continue;
      }
      failures.push(
        ...validateClaim(parsed.data, source.data).map((x) => `${c.id}: ${x}`),
      );
      if (c.audit?.verdict !== "accept")
        failures.push(`${c.id}: missing accept verdict`);
    }
  if (
    ["v824SHV6COE", "J25UuUqHT3Y", "skc2T5fcoLY"].includes(run.videoId) &&
    claims.some((c) => c.passed)
  )
    failures.push(
      "Explanatory research must not invent a creator investment decision.",
    );
  if (
    run.videoId === "J25UuUqHT3Y" &&
    points.filter((c) => c.passed).length < 4
  )
    failures.push(
      "Macro context coverage is too sparse (minimum four distinct supported points; not a full semantic-recall score).",
    );
  if (
    run.videoId === "1_JCqHluJ9U" &&
    !claims.some(
      (c) => c.passed && c.claim.ticker === "VST" && c.claim.stance === "avoid",
    )
  )
    failures.push("Missing explicit VST not-buying decision.");
  if (run.videoId === "kXYvRR7gV2E") {
    if (claims.some((c) => c.passed))
      failures.push("Educational video must not invent a trade idea.");
    if (points.filter((c) => c.passed).length < 3)
      failures.push(
        "Educational synthesis misses key-point coverage (minimum three topics).",
      );
  }
  if (run.videoId === "3u24qyWjSVM") {
    // Provisional expectations from retained Chinese text, not independent audio ground truth.
    for (const ticker of ["VOO", "QQQ"])
      if (!claims.some((c) => c.passed && c.claim.ticker === ticker))
        failures.push(
          `Missing separate ${ticker} idea from the retained source.`,
        );
    if (
      !claims.some(
        (c) => c.passed && /reddit/i.test(c.claim.instrument_as_spoken || ""),
      )
    )
      failures.push("Missing Reddit position-monitoring discussion.");
    if (points.filter((c) => c.passed).length < 3)
      failures.push(
        "Macro/context coverage is too sparse (minimum three points).",
      );
  }
  return {
    pass: failures.length === 0,
    score: failures.length ? 0 : 1,
    reason: failures.length
      ? failures.join(" | ")
      : "Passed retained-text regression checks; audio fidelity and semantic accuracy remain unverified.",
  };
}
