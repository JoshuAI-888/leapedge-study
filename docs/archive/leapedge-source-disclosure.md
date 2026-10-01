# LeapEdge source fallback disclosure

Checked 14 September 2026 against public first-party pages:

- https://leapedge.app/how-it-works
- https://leapedge.app/faq

The walkthrough describes three caption libraries tried sequentially. If unavailable or language-mismatched, a multimodal LLM receives the watch URL and uses server-side video fetching to return a transcript. Local audio downloads are not part of the described path. It also describes fast key-point extraction, deeper synthesis, a fast-model critique and substring matching of quotes to transcript segments.

The FAQ qualifies captionless fallback as working for most such videos. Neither page specifies the caption libraries, exact fetch API, retry/backoff behavior, audio quality benchmark or long-video completeness validation. The developer description supplied by the user names Gemini and its Files API; this does not establish the precise request shape or that our OpenRouter video path behaves identically.

The public walkthrough's model names differ from newer metadata observed in the signed-in app, so treat it as an architectural description rather than a current model manifest. No claim of universal availability or independently verified audio accuracy follows from a successful report.
