import copy
import unittest
from leapstudy.evidence import assess_time_coverage, chunks, validate_claim, validate_segments, video_id


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.source = {"source_kind": "model_generated_transcript", "segments": [
            {"id": "s1", "text": "如果已经买入，止损设为140美元。", "start_seconds": 10, "end_seconds": 15},
            {"id": "s2", "text": "I am not recommending a new entry.", "start_seconds": 15, "end_seconds": 20}]}
        self.claim = {"thesis_en": "For existing positions, set a stop at 140 dollars.",
            "stance": "conditional", "levels": [{"kind": "stop", "value_original": "140"}],
            "evidence": [{"segment_id": "s1", "quote_original": "止损设为140美元。"}]}

    def test_exact_match_does_not_certify_audio(self):
        result = validate_claim(self.claim, self.source)
        self.assertTrue(result["passed"])
        self.assertFalse(result["audio_verified"])

    def test_invented_quote_rejected(self):
        self.claim["evidence"][0]["quote_original"] = "Buy at 140 dollars."
        self.assertIn("quote_not_exact", validate_claim(self.claim, self.source)["errors"])

    def test_unknown_segment_rejected(self):
        self.claim["evidence"][0]["segment_id"] = "fabricated"
        self.assertFalse(validate_claim(self.claim, self.source)["passed"])

    def test_invented_level_rejected(self):
        self.claim["levels"][0]["value_original"] = "150"
        self.assertIn("level_not_in_evidence", validate_claim(self.claim, self.source)["errors"])

    def test_price_substring_is_not_evidence(self):
        self.claim["levels"][0]["value_original"] = "14"
        self.assertIn("level_not_in_evidence", validate_claim(self.claim, self.source)["errors"])

    def test_inferred_ticker_is_not_published(self):
        self.claim.update(ticker="QQQ", ticker_explicit=False)
        self.assertIn("unresolved_ticker_mapping", validate_claim(self.claim, self.source)["errors"])

    def test_duplicate_ids_and_invalid_times_rejected(self):
        for source in [
            {"segments": [self.source["segments"][0]] * 2},
            {"segments": [{"id": "x", "text": "x", "start_seconds": float("nan"), "end_seconds": 2}]}]:
            with self.assertRaises(ValueError):
                validate_segments(source)

    def test_url_canonicalization_and_host_validation(self):
        self.assertEqual(video_id("https://youtu.be/3u24qyWjSVM?t=20"), "3u24qyWjSVM")
        self.assertEqual(video_id("https://youtube.com/shorts/3u24qyWjSVM"), "3u24qyWjSVM")
        for url in ["https://youtube.com.attacker.test/watch?v=3u24qyWjSVM", "https://youtube.com/watch?v=bad"]:
            with self.assertRaises(ValueError):
                video_id(url)

    def test_chunk_coverage(self):
        segments = [{"id": str(i), "text": "word " * 20} for i in range(30)]
        result = chunks(segments, max_chars=500)
        self.assertEqual({s["id"] for b in result for s in b}, {s["id"] for s in segments})

    def test_missing_timestamp_remains_missing(self):
        source = copy.deepcopy(self.source)
        source["segments"][0].update(start_seconds=None, end_seconds=None)
        self.assertIsNone(validate_claim(self.claim, source)["matched_evidence"][0]["start_seconds"])

    def test_successful_but_incomplete_transcript_is_flagged(self):
        source = {"segments": [{"id": "s1", "text": "The end.", "start_seconds": 0, "end_seconds": 1800}]}
        result = assess_time_coverage(source,2424)
        self.assertFalse(result["structurally_complete"])
        self.assertEqual(result["uncovered_intervals"],[[1800,2424]])

    def test_internal_missing_section_is_flagged(self):
        source = {"segments": [
            {"id": "s1", "text": "First", "start_seconds": 0, "end_seconds": 100},
            {"id": "s2", "text": "Last", "start_seconds": 200, "end_seconds": 300}]}
        self.assertFalse(assess_time_coverage(source,300)["structurally_complete"])


if __name__ == "__main__":
    unittest.main()
