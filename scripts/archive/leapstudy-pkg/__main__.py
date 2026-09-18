import argparse
import hashlib
import json
from pathlib import Path

from .evidence import chunks, validate_claim, validate_segments, video_id
from .provider import OpenRouter, load_env
from . import prompts


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Personal evidence-first video research pilot")
    parser.add_argument("--env-file", help="Explicit local credential file; never committed")
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--budget-usd", type=float, default=5)
    sub = parser.add_subparsers(dest="command", required=True)
    transcribe = sub.add_parser("transcribe")
    transcribe.add_argument("url")
    transcribe.add_argument("--model", default="google/gemini-3.1-flash-lite")
    transcribe.add_argument("--out", required=True)
    analyze = sub.add_parser("analyze")
    analyze.add_argument("source")
    analyze.add_argument("--extract-model", default="google/gemini-3.1-flash-lite")
    analyze.add_argument("--synthesis-model", default="google/gemini-3.8-flash")
    analyze.add_argument("--critic-model", default="google/gemini-3.8-flash")
    analyze.add_argument("--out", required=True)
    args = parser.parse_args()
    if args.budget_usd <= 0:
        parser.error("Budget must be positive")
    if args.env_file:
        load_env(args.env_file)
    provider = OpenRouter(args.data_dir, args.budget_usd)
    if args.command == "transcribe":
        vid = video_id(args.url)
        source, metrics = provider.call(args.model, prompts.TRANSCRIBE,
                    video_url="https://www.youtube.com/watch?v=" + vid, max_tokens=28000)
        validate_segments(source)
        source.update(video_id=vid, source_kind="model_generated_transcript",
                      provenance={"metrics": metrics, "prompt_version": prompts.VERSION,
                                  "audio_verified": False, "coverage_verified": False})
        save(args.out, source)
        print(json.dumps({"source": args.out, "segments": len(source["segments"]), "metrics": metrics}))
        return
    source = json.loads(Path(args.source).read_text())
    segments = validate_segments(source)
    metrics, candidates, coverage = [], [], []
    for batch in chunks(segments):
        result, timing = provider.call(args.extract_model, prompts.EXTRACT, batch)
        if not isinstance(result.get("claims"), list):
            raise ValueError("Missing claims array")
        candidates.extend(result["claims"])
        metrics.append({"stage": "extract", **timing})
        coverage.append([s["id"] for s in batch])
    draft, timing = provider.call(args.synthesis_model, prompts.SYNTHESIZE + "\nSCHEMA:\n" + prompts.EXTRACT,
                                  {"candidates": candidates, "source": segments}, max_tokens=14000)
    metrics.append({"stage": "synthesize", **timing})
    if not isinstance(draft.get("claims"), list):
        raise ValueError("Missing draft claims array")
    report = {"prompt_version": prompts.VERSION, "source_hash": hashlib.sha256(Path(args.source).read_bytes()).hexdigest(),
              "video_id": source.get("video_id"), "source_kind": source.get("source_kind"),
              "output_language": "English", "coverage": coverage,
              "accepted": [], "rejected": [], "metrics": metrics,
              "limitations": ["Text validation does not prove transcription or timestamp accuracy.",
                              "Model critic acceptance is not human verification."]}
    for i, claim in enumerate(draft["claims"]):
        validation = validate_claim(claim, source)
        item = {"id": f"c{i+1:03}", "claim": claim, "validation": validation}
        if validation["passed"]:
            audit, timing = provider.call(args.critic_model, prompts.CRITIQUE, {"claim": claim, "source": segments}, max_tokens=2000)
            metrics.append({"stage": "critique", **timing})
            item["audit"] = audit
            # Unknown/malformed verdicts and audio-review requirements fail closed.
            accepted = (audit.get("verdict") == "accept" and audit.get("requires_audio_review") is False
                        and audit.get("unsupported_fields") == [] and isinstance(audit.get("reason_en"), str))
        else:
            accepted = False
        report["accepted" if accepted else "rejected"].append(item)
        save(args.out, report)
    save(args.out, report)
    print(json.dumps({"report": args.out, "accepted": len(report["accepted"]),
                      "rejected": len(report["rejected"]), "calls": len(metrics)}))


if __name__ == "__main__":
    main()
