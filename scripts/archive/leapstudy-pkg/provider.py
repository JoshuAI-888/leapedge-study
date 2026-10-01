"""OpenRouter adapter with conservative local spend reservations. Sequential use only."""
import hashlib
import json
import os
from pathlib import Path
import ssl
import time
import urllib.error
import urllib.request


class ProviderHTTPError(RuntimeError):
    def __init__(self, status):
        self.status = status
        super().__init__(f"OpenRouter HTTP {status}; no automatic retry")


def load_env(path):
    """Read explicit local key file without printing it or executing shell syntax."""
    for line in Path(path).read_text().splitlines():
        if line.startswith("OPENROUTER_API_KEY="):
            os.environ["OPENROUTER_API_KEY"] = line.partition("=")[2].strip().strip('"\'')


def context():
    bundle = os.environ.get("SSL_CERT_FILE")
    if not bundle and Path("/etc/ssl/cert.pem").exists():
        bundle = "/etc/ssl/cert.pem"
    return ssl.create_default_context(cafile=bundle)


class OpenRouter:
    def __init__(self, root="data", limit_usd=5.0):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.limit = limit_usd
        self.ledger_path = self.root / "ledger.json"
        self.ledger = json.loads(self.ledger_path.read_text()) if self.ledger_path.exists() else []
        self.models = {m["id"]: m for m in self.request("models")["data"]}

    def request(self, path, body=None):
        headers = {"Content-Type": "application/json"}
        if body is not None:
            key = os.environ.get("OPENROUTER_API_KEY")
            if not key:
                raise ValueError("OPENROUTER_API_KEY is not configured")
            headers["Authorization"] = "Bearer " + key
        request = urllib.request.Request("https://openrouter.ai/api/v1/" + path,
                    data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=240, context=context()) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            # Avoid writing provider bodies that might reflect credentials or source text.
            raise ProviderHTTPError(exc.code) from None

    def save_ledger(self):
        temp = self.ledger_path.with_suffix(".tmp")
        temp.write_text(json.dumps(self.ledger, indent=2))
        temp.replace(self.ledger_path)

    def call(self, model, prompt, payload=None, video_url=None, max_tokens=10000):
        if model not in self.models:
            raise ValueError("Model not in current provider catalogue: " + model)
        spec = self.models[model]
        content = [{"type": "text", "text": prompt + ("\nSOURCE DATA:\n" + json.dumps(payload, ensure_ascii=False) if payload is not None else "")}]
        provider = {"allow_fallbacks": False, "require_parameters": True}
        if video_url:
            content.append({"type": "video_url", "video_url": {"url": video_url}})
            provider["only"] = ["Google AI Studio"]
        body = {"model": model, "messages": [{"role": "user", "content": content}],
                "max_tokens": max_tokens, "temperature": 0, "provider": provider,
                "response_format": {"type": "json_object"}}
        digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
        cached = self.root / (digest + ".json")
        if cached.exists():
            result = json.loads(cached.read_text())
            return result["parsed"], {**result["metrics"], "cache_hit": True}
        pricing = spec["pricing"]
        rates = [pricing] + pricing.get("overrides", [])
        input_rate = max(float(p.get("prompt", pricing["prompt"])) for p in rates)
        output_rate = max(float(p.get("completion", pricing["completion"])) for p in rates)
        # UTF-8 bytes conservatively exceed ordinary text token counts. For video
        # reserve the entire advertised context at the highest relevant input rate.
        input_bound = spec["context_length"] if video_url else len(json.dumps(body, ensure_ascii=False).encode()) + 4096
        if input_bound + max_tokens > spec["context_length"] and not video_url:
            raise ValueError("Conservative context limit reached; reduce source size")
        if video_url:
            input_rate = max(input_rate, *(float(p.get("audio", 0)) for p in rates))
        reserve = input_bound * input_rate + max_tokens * output_rate
        used = sum(item["charged_or_reserved_usd"] for item in self.ledger)
        if used + reserve > self.limit:
            raise ValueError(f"Budget guard: ${used:.4f} used/reserved + ${reserve:.4f} exceeds ${self.limit:.2f}")
        record = {"request_hash": digest, "model": model, "started_at": time.time(),
                  "charged_or_reserved_usd": reserve, "status": "reserved"}
        self.ledger.append(record)
        self.save_ledger()
        start = time.monotonic()
        try:
            result = self.request("chat/completions", body)
        except ProviderHTTPError as exc:
            if exc.status in {400, 401, 402, 404, 422}:
                record["charged_or_reserved_usd"] = 0
                record["status"] = f"rejected_http_{exc.status}"
                self.save_ledger()
            raise
        metrics = {"model": result.get("model", model), "provider": result.get("provider"),
                   "seconds": time.monotonic() - start, "usage": result.get("usage", {}), "cache_hit": False}
        usage_cost = metrics["usage"].get("cost")
        if isinstance(usage_cost, (int, float)) and usage_cost >= 0:
            record["charged_or_reserved_usd"] = usage_cost
        record["status"] = "received"
        self.save_ledger()
        choice = result.get("choices", [{}])[0]
        if choice.get("finish_reason") != "stop":
            raise ValueError("Incomplete model response; refusing partial evidence")
        text = choice.get("message", {}).get("content", "")
        parsed = json.loads(text)
        if not isinstance(parsed, dict) or parsed.get("error"):
            raise ValueError("Model returned an error or non-object response")
        cached.write_text(json.dumps({"parsed": parsed, "metrics": metrics}, ensure_ascii=False, indent=2))
        return parsed, metrics
