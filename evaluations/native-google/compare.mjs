// Offline disagreement analysis, not audio-grounded accuracy. No API calls.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  units,
  editCounts,
  ACCURACY_VERSION,
  scoreAccuracy,
} from "../transcript-accuracy.ts";
const directory = "data/native-google-20260915";
const cases = [
  ["SHMPiWbbR6E", "2acd7054-a4f3-4aae-875e-972f7c44dc5d", "en"],
  ["wkAqHlYL7bQ", "0df6588a-cad3-411f-9202-12aac1c57495", "en"],
  ["3u24qyWjSVM", "fe349e23-40c9-4f38-986d-a252a6591b96", "zh"],
];
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const comparisons = [];
for (const [videoId, attemptId, language] of cases) {
  const native = JSON.parse(readFileSync(`${directory}/${attemptId}.json`))
    .assessment.data;
  const caption = JSON.parse(
    readFileSync(
      `work/completion-next/provider-raw/transcriptapi-${videoId}-1-source.json`,
    ),
  );
  const a = caption.segments
      .map((s) => s.text)
      .join(language === "zh" ? "" : " "),
    b = native.segments.map((s) => s.text).join(language === "zh" ? "" : " ");
  const au = units(a, language),
    bu = units(b, language);
  const edits = editCounts(au, bu);
  comparisons.push({
    videoId,
    attemptId,
    language,
    baseline: "Historical TranscriptAPI captions (not ground truth)",
    baselineUnits: au.length,
    candidateUnits: bu.length,
    edits,
    tokenEditDisagreement: edits.errors / au.length,
    normalizationVersion: ACCURACY_VERSION,
    baselineHash: hash(caption),
    nativeHash: hash(native),
    audioVerified: false,
    captionQqqOccurrences: (a.match(/QQQ/g) ?? []).length,
    nativeQqqOccurrences: (b.match(/QQQ/g) ?? []).length,
  });
}
// Fixed review packet: development windows only; no false held-out labels after inspection.
const windows = [
  ["SHMPiWbbR6E", "2acd7054-a4f3-4aae-875e-972f7c44dc5d", "en", 50, 110],
  ["CMjt6f4eVdA", "4e93d949-2083-43e3-98f5-fea6b133a4ad", "zh", 500, 540],
  ["CMjt6f4eVdA", "4e93d949-2083-43e3-98f5-fea6b133a4ad", "zh", 610, 665],
  ["CMjt6f4eVdA", "4e93d949-2083-43e3-98f5-fea6b133a4ad", "zh", 680, 730],
  ["J25UuUqHT3Y", "58f33c11-2036-42e7-8d8c-b4a5f0b9e02c", "zh", 1170, 1260],
  ["wkAqHlYL7bQ", "0df6588a-cad3-411f-9202-12aac1c57495", "en", 0, 60],
  ["wkAqHlYL7bQ", "0df6588a-cad3-411f-9202-12aac1c57495", "en", 1180, 1240],
  ["wkAqHlYL7bQ", "0df6588a-cad3-411f-9202-12aac1c57495", "en", 2350, 2423],
  ["3u24qyWjSVM", "fe349e23-40c9-4f38-986d-a252a6591b96", "zh", 395, 475],
];
const packet = windows.map(
  ([videoId, id, language, startSeconds, endSeconds], i) => {
    const x = JSON.parse(readFileSync(`${directory}/${id}.json`)).assessment
      .data;
    const candidates = [
      {
        provider: "native-google",
        sourceHash: hash(x),
        text: x.segments
          .filter(
            (s) => s.end_seconds > startSeconds && s.start_seconds < endSeconds,
          )
          .map((s) => s.text)
          .join(language === "zh" ? "" : " "),
        boundariesReviewed: false,
        facts: [],
        anchors: [],
      },
    ];
    const path = `work/completion-next/provider-raw/transcriptapi-${videoId}-1-source.json`;
    if (existsSync(path)) {
      const c = JSON.parse(readFileSync(path));
      candidates.push({
        provider: "historical-transcriptapi",
        sourceHash: hash(c),
        text: c.segments
          .filter(
            (s) => s.end_seconds > startSeconds && s.start_seconds < endSeconds,
          )
          .map((s) => s.text)
          .join(language === "zh" ? "" : " "),
        boundariesReviewed: false,
        facts: [],
        anchors: [],
      });
    }
    return {
      id: `native-review-${i + 1}`,
      videoId,
      language,
      split: "development",
      startSeconds,
      endSeconds,
      reference: {
        status: "pending_audio_review",
        text: "",
        reviewer: "",
        reviewedAt: "",
        criticalFacts: [],
        anchors: [],
      },
      candidates,
    };
  },
);
writeFileSync(
  `${directory}/audio-review-packet.json`,
  JSON.stringify(packet, null, 2),
  { mode: 0o600 },
);
const scores = packet.flatMap(scoreAccuracy);
writeFileSync(
  "docs/native-google-comparison-results.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      comparisons,
      independentAudioScoresComputed: 0,
      pendingCandidateReviews: scores.length,
      reviewWindows: packet.map((p) => ({
        id: p.id,
        videoId: p.videoId,
        start: p.startSeconds,
        end: p.endSeconds,
        url: `https://www.youtube.com/watch?v=${p.videoId}&t=${p.startSeconds}s`,
        status: "pending_audio_review",
      })),
      limitations: [
        "Edit disagreement measures differences from captions, not accuracy.",
        "Candidate excerpts retain whole overlapping segments and require boundary review.",
        "All windows are development cases; independently selected held-out videos are still required.",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({ comparisons, pendingCandidateReviews: scores.length }),
);
