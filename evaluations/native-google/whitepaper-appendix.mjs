// Offline: refresh generated tables after report.mjs, preserving authored sections.
import { readFileSync, writeFileSync } from "node:fs";
const r = JSON.parse(readFileSync("docs/native-google-live-results.json"));
const s = JSON.parse(readFileSync("docs/native-google-shadow-results.json"));
const money = (v) => (v === null || v === undefined ? "unknown" : v.toFixed(6));
const cell = (v) =>
  String(v ?? "unknown")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
const lines = [
  "### A. Complete request ledger",
  "",
  `Recorded requests: **${r.attempts.length}**. Terminal local outcomes: **${r.attempts.filter((a) => a.terminal).length}**. Held reservations: **NZ$${r.reservedNzd.toFixed(2)} / NZ$50**. Known estimates: **US$${r.estimatedKnownUsd.toFixed(6)}**, with **${r.unknownCostAttempts} unknown-cost attempts**. A terminal local timeout still has uncertain upstream completion/billing.`,
  "",
  "| Attempt ID | Case/stage | Result | Seconds | Segments | Estimate US$ | Held NZ$ |",
  "|---|---|---|---:|---:|---:|---:|",
];
for (const a of r.attempts)
  lines.push(
    `| ${a.attemptId} | ${cell(a.configuration?.case ?? a.configuration?.stage ?? a.configuration?.diagnostic ?? a.videoId)} | ${a.outcome} | ${((a.latencyMs ?? 0) / 1000).toFixed(3)} | ${a.segments ?? "—"} | ${money(a.estimatedUsd)} | ${a.reservedNzd.toFixed(2)} |`,
  );
lines.push(
  "",
  "### B. Token telemetry",
  "",
  "Unknown thought counts are deliberately shown as unknown. No AUDIO-versus-caption completeness claim is inferred from these fields.",
  "",
  "| Attempt ID | Prompt | Candidate | Thought | Total | Input modality detail |",
  "|---|---:|---:|---:|---:|---|",
);
for (const a of r.attempts) {
  const u = a.usage;
  lines.push(
    `| ${a.attemptId} | ${u?.promptTokenCount ?? "unknown"} | ${u?.candidatesTokenCount ?? "unknown"} | ${u?.thoughtsTokenCount ?? "unknown"} | ${u?.totalTokenCount ?? "unknown"} | ${cell(u?.promptTokensDetails?.map((x) => `${x.modality}:${x.tokenCount}`).join(", "))} |`,
  );
}
lines.push(
  "",
  "### C. Synthesis A/B result",
  "",
  "| Variant | Draft claims | Draft key points | Structural rejects | Text critic accepts | Accepted claims / key points |",
  "|---|---:|---:|---:|---:|---|",
);
for (const x of s.shadows) {
  const i = x.items;
  lines.push(
    `| ${x.promptVersion} | ${i.filter((y) => y.kind === "claim").length} | ${i.filter((y) => y.kind === "key_point").length} | ${i.filter((y) => y.structuralReasons.length).length} | ${i.filter((y) => y.textAccepted).length} | ${i.filter((y) => y.textAccepted && y.kind === "claim").length} / ${i.filter((y) => y.textAccepted && y.kind === "key_point").length} |`,
  );
}
lines.push(
  "",
  "The baseline and candidate each have one synthesis sample, with different resulting draft contents. This is a development A/B, not a statistically isolated causal estimate. Eight candidate items passed model text critique; one of those subsequently received the additional semantic review flag below. No item is independently audio verified.",
  "",
  "| Candidate finding | Review layer | Status |",
  "|---|---|---|",
);
for (const x of s.textReview)
  lines.push(`| ${cell(x.finding)} | ${x.reviewType} | ${x.status} |`);
lines.push(
  "",
  "### D. Data and script references",
  "",
  "- [Full sanitized attempt record](native-google-live-results.json)",
  "- [Caption disagreement and pending review windows](native-google-comparison-results.json)",
  "- [Per-item baseline/candidate results](native-google-shadow-results.json)",
  "- [Research source register](native-google-research-sources.json)",
  "- [Archived source hashes](native-google-source-snapshots.json)",
  "- [Executable script hashes](native-google-script-manifest.json)",
  "- [Original first-funded assessment, with follow-up notice](native-google-live-assessment.md)",
  "",
  "Private immutable response files are located under `data/native-google-20260915/{attemptId}.json`; raw hashes in the public JSON allow verification without publishing transcripts. The pending audio packet is `data/native-google-20260915/audio-review-packet.json`. No keys or full raw model responses are included in this white paper.",
  "",
);
const p = "docs/native-google-findings-white-paper.md";
const authored = readFileSync(p, "utf8").split("<!-- GENERATED_RESULTS -->")[0];
writeFileSync(
  p,
  authored + "<!-- GENERATED_RESULTS -->\n\n" + lines.join("\n"),
);
console.log(
  JSON.stringify({
    requests: r.attempts.length,
    shadowRuns: s.shadows.length,
    whitepaper: p,
  }),
);
