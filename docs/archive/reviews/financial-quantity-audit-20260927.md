# Retained financial quantity audit — 27 September 2026

Scope: read-only review of 161 typed fact records: candidate A's twelve published briefs contain128 records (108 distinct, twenty repeated); B contains15; C contains18. No new provider or LeapEdge calls. These are selected retained outputs, not a statistical accuracy estimate.

Every inspected quote was an exact substring of its cited retained evidence, and every fact cited an evidence ID present on its sentence. That structural agreement did **not** prevent wrong financial dimensions.

| Retained case / sentence | Defect | Required handling |
|---|---|---|
| C `SPIRV9UjNYU`, `s4` twice and `s5` |25 basis points encoded as25 percentage points; prose correct | Explicit basis-point type and anchored unit correction, preserve correct prose and original model fields |
| A `iBMZc7zs_Ew`, `s12` |400 basis points encoded as400 percentage points | Same100× unit check |
| A `pWnu1C8I6Xw`, `s-2`, `s-3` |1.1million ordinary shares and100 ordinary shares encoded as contracts | Match exact ordinary-share count and scale; never conflate option contracts |
| A `LF7fgz1HAFs`, `s-7` |35million-share ATM issuance ceiling encoded per share | Separate share count from price-per-share; retain ceiling/context |
| A `SPIRV9UjNYU`, `s-3` and repeated supplement |USD104 per barrel encoded as total amount | Explicit per-barrel denomination, only with anchored currency/value/scale |
| A `iBMZc7zs_Ew`, `s35` |“Decline from peak” label adds an unsupported comparison baseline | Keep proposed field unresolved; do not invent a peak or entry reference |

Additional missing semantics: capacity fields do not identify GW versus currency-per-MW; FX amounts lack the other currency denominator; some approximation/inequality wording survives in prose but is absent from structured fields. Unknown dimensions and qualifiers must remain explicit, and these records must not be treated as calculation-ready merely because their quotes match.

The source's arithmetic and transcription can also be uncertain. A retained +0.70→−0.45 source describes a1.20% decline; the endpoint difference is1.15percentage points, but the source may round. Do not silently rewrite its claim. A caption says Nvidia throughput improved67times; no audio confirmation establishes whether it should be6–7times. A creator's claim of12% returns “with no risk” must remain attributed, not a verified risk-free return.

The implementation keeps raw drafts and original facts. Narrow, unambiguous unit mappings may be corrected with a visible reason and retained original proposal. Mixed or unsupported mappings remain visible as unresolved fields. Model-supplied unit descriptions and qualifiers remain model assessed; this does not provide independent financial verification.
