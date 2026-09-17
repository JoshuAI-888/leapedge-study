# Frozen model responses

Each file here is one real provider response, captured once by a human with
live API keys and committed so the test suite can replay it without any key.
Tests never call a model; they load these files through
`tests/helpers/frozen.ts` (`loadFrozen(stage, hash)`) and a fake transport.

## File name

`<stage>-<hash>.json`

- `stage` is the pipeline stage that made the call (`transcribe`,
  `extraction`, `synthesis`, `synthesis-chunk-0`, `critique`, ...),
  lower-case letters, digits and hyphens.
- `hash` is `requestHash(request)`: the first 16 hex characters of SHA-256
  over the request JSON with object keys sorted. The same request always names
  the same file, so a test that builds the request can find its response.

## File contents

```json
{
  "stage": "extraction",
  "hash": "3f9c1a2b4d5e6f70",
  "model": "google/gemini-3.5-flash",
  "capturedAt": "2026-09-10T08:00:00.000Z",
  "request": { "...the request body that was sent..." : "" },
  "response": { "...the provider's parsed response..." : "" },
  "note": "optional: what this case exercises"
}
```

`stage` and `hash` must match the file name; `loadFrozen` refuses a file
that disagrees with its name or fails the schema.

## Capturing a file

1. Run the pipeline stage once against the real provider with your own key
   (for example through the Lab or an evaluation script) and keep the request
   and response bodies.
2. Compute the hash with `requestHash(request)` from `tests/helpers/frozen.ts`.
3. Write the envelope above to `tests/fixtures/model/<stage>-<hash>.json`.
4. Remove anything secret from `request` (keys never appear in a body, but
   check headers were not copied in) and commit the file.

Never edit a captured `response` by hand: the point of the file is that it is
what the provider really returned. If the model or prompt changes, capture a
new file; the old one stays valid for the request it names.
