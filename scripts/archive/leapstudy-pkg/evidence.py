"""Deterministic source checks. Text matches do not establish audio truth."""
import math
import re
from urllib.parse import parse_qs, urlparse


def video_id(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.username or parsed.password:
        raise ValueError("Use an HTTPS YouTube URL")
    if parsed.hostname in {"youtu.be", "www.youtu.be"}:
        value = parsed.path.strip("/")
    elif parsed.hostname in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
        parts = parsed.path.strip("/").split("/")
        value = parse_qs(parsed.query).get("v", [""])[0] if parsed.path == "/watch" else (
            parts[1] if len(parts) == 2 and parts[0] in {"shorts", "live", "embed"} else "")
    else:
        raise ValueError("Unsupported video host")
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", value):
        raise ValueError("Invalid YouTube video ID")
    return value


def validate_segments(source):
    segments = source.get("segments")
    if not isinstance(segments, list) or not segments:
        raise ValueError("No source segments")
    seen = set()
    for segment in segments:
        sid = segment.get("id")
        if not isinstance(sid, str) or not sid or sid in seen:
            raise ValueError("Segment IDs must be unique nonempty strings")
        seen.add(sid)
        if not isinstance(segment.get("text"), str) or not segment["text"].strip():
            raise ValueError("Empty segment")
        start, end = segment.get("start_seconds"), segment.get("end_seconds")
        if (start is None) != (end is None):
            raise ValueError("Provide both start/end or neither")
        if start is not None:
            if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in (start, end)):
                raise ValueError("Invalid timestamp")
            if start < 0 or end <= start:
                raise ValueError("Invalid timestamp range")
    return segments


def chunks(segments, max_chars=24000, overlap=2):
    """Keep whole segments and repeat boundary context; never drop source segments."""
    if max_chars < 1 or overlap < 0:
        raise ValueError("Invalid chunk parameters")
    batches, current, size = [], [], 0
    for segment in segments:
        length = len(segment["text"])
        if current and size + length > max_chars:
            batches.append(current)
            current = current[-overlap:] if overlap else []
            size = sum(len(item["text"]) for item in current)
        current = current + [segment]
        size += length
    if current:
        batches.append(current)
    return batches


def assess_time_coverage(source, expected_duration, tolerance_seconds=10):
    """Detect obvious omitted intervals using independent metadata.

    Passing is only a structural check: generated timestamps can themselves be wrong.
    """
    segments = validate_segments(source)
    if expected_duration <= 0 or not math.isfinite(expected_duration):
        raise ValueError("Expected duration must be positive and finite")
    intervals = sorted((s["start_seconds"], s["end_seconds"]) for s in segments if s.get("start_seconds") is not None)
    cursor, gaps = 0, []
    for start, end in intervals:
        if start > cursor + tolerance_seconds:
            gaps.append([cursor, min(start, expected_duration)])
        cursor = max(cursor, end)
    if cursor < expected_duration - tolerance_seconds:
        gaps.append([cursor, expected_duration])
    return {"structurally_complete": bool(intervals) and not gaps,
            "uncovered_intervals": gaps, "audio_verified": False,
            "expected_duration_seconds": expected_duration}


def validate_claim(claim, source):
    """Fail closed on bad spans and unsupported structured numbers.

    Semantic support, entity mapping and negation are separate critic/human checks.
    Level values must retain source notation for deterministic matching.
    """
    segments = {s["id"]: s for s in validate_segments(source)}
    errors, matched = [], []
    if not claim.get("thesis_en"):
        errors.append("missing_thesis")
    evidence = claim.get("evidence", [])
    if not evidence:
        errors.append("missing_evidence")
    for span in evidence:
        segment = segments.get(span.get("segment_id"))
        quote = span.get("quote_original")
        if segment is None:
            errors.append("unknown_segment")
        elif not isinstance(quote, str) or not quote.strip() or quote not in segment["text"]:
            errors.append("quote_not_exact")
        else:
            # A repeated quote is ambiguous: don't invent a subsegment timestamp.
            matched.append({"segment_id": segment["id"], "quote_original": quote,
                            "quote_translation_en": span.get("quote_translation_en"),
                            "start_seconds": segment.get("start_seconds"),
                            "end_seconds": segment.get("end_seconds")})
    joined_quotes = "\n".join(s["quote_original"] for s in matched)
    for level in claim.get("levels", []):
        value = level.get("value_original")
        if not isinstance(value, str) or not value or not re.search(r"(?<![\d.])" + re.escape(value) + r"(?![\d.])", joined_quotes):
            errors.append("level_not_in_evidence")
        if level.get("kind") not in {"entry", "target", "stop", "support", "resistance"}:
            errors.append("invalid_level_kind")
    if claim.get("stance") not in {"long", "short", "neutral", "avoid", "watch", "hold", "conditional"}:
        errors.append("invalid_stance")
    if claim.get("ticker") and claim.get("ticker_explicit") is not True:
        errors.append("unresolved_ticker_mapping")
    return {"passed": not errors, "errors": sorted(set(errors)), "matched_evidence": matched,
            "source_kind": source.get("source_kind", "unknown"),
            "audio_verified": source.get("source_kind") == "human_verified_transcript"}
