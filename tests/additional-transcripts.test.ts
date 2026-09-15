import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTapline,
  normalizeBibiGPT,
} from "../src/server/youtube-intelligence/additional-transcript-formats.ts";
test("Tapline SRT retains exact multiline text and rejects mismatched or invalid sources", () => {
  const input = {
    transcript: "1\n00:00:01,500 --> 00:00:03,000\n不要买\n1.5%\n",
    is_auto_generated: false,
    metadata: { video_id: "fixture", duration: 5 },
  };
  const s = normalizeTapline(input, "fixture", "zh-CN").source;
  assert.equal(s.segments[0].text, "不要买\n1.5%");
  assert.equal(s.segments[0].start_seconds, 1.5);
  assert.equal(s.segment_separator, "");
  assert.throws(() => normalizeTapline(input, "different", "zh"));
  assert.throws(() =>
    normalizeTapline(
      {
        ...input,
        transcript: input.transcript.replace("00:00:03,000", "00:00:00,000"),
      },
      "fixture",
      "zh",
    ),
  );
});
test("BibiGPT never admits preview, polished-only or reversed-time subtitles as complete evidence", () => {
  const input = {
    success: true,
    id: "fixture",
    service: "youtube",
    detail: {
      id: "fixture",
      duration: 10,
      rawLang: "zh",
      subtitlesArray: [{ startTime: 1, end: 3, text: "不要买" }],
    },
  };
  assert.equal(
    normalizeBibiGPT(input, "fixture").source.source_kind,
    "provider_transcript_bibigpt",
  );
  assert.throws(
    () =>
      normalizeBibiGPT(
        { ...input, detail: { ...input.detail, isPreviewOnly: true } },
        "fixture",
      ),
    /Preview/,
  );
  assert.throws(() =>
    normalizeBibiGPT(
      {
        ...input,
        detail: { ...input.detail, subtitlesArray: [], polishedText: "不要买" },
      },
      "fixture",
    ),
  );
  assert.throws(() =>
    normalizeBibiGPT(
      {
        ...input,
        detail: {
          ...input.detail,
          subtitlesArray: [{ startTime: 3, end: 1, text: "不要买" }],
        },
      },
      "fixture",
    ),
  );
});

test("BibiGPT missing language stays unknown and success with empty subtitles is rejected", () => {
  const input = {
    success: true,
    id: "fixture",
    service: "youtube",
    detail: {
      id: "fixture",
      duration: 10,
      rawLang: "",
      subtitlesArray: [{ startTime: 0, end: 3, text: "Original text" }],
    },
  };
  assert.equal(normalizeBibiGPT(input, "fixture").source.language, undefined);
  assert.throws(() =>
    normalizeBibiGPT(
      { ...input, detail: { ...input.detail, subtitlesArray: [] } },
      "fixture",
    ),
  );
});
