# Optimisation benchmark harness boundaries

The reusable `scripts/optimization-live-benchmark.mjs` requires `--live` and exclusively creates its output file before importing runtime code. It refuses an existing destination. This protects captured evidence and discourages accidental paid replay; it does not make the in-memory experiment restartable. A crashed experiment requires reviewing the retained export and provider costs before choosing a new output path.

Phase-one runs explicitly disable speculative research and retrieval-cache reuse. Every research brief receives an empty frozen baseline, preventing earlier generated briefs from changing later novelty inputs. Source transcripts and original analysis dates are retained. Search remains live, so retrieved text can differ across trials even with equal cutoffs.

Revision metadata checks the requested SHA against checkout HEAD where available, otherwise `installed-revision.txt` or `CODE_REVISION`. A dirty checkout is marked unverified. A matching installed marker verifies the marker, not installed file contents; when no marker is available, verification is explicitly false. The installed runtime currently contains conflicting historical markers; `installed-revision.txt` is preferred, and this alone is not proof of exact installed source content.

## Current September 20 full experiment

The already-started `data/optimization-20260920/full-ab.mjs` experiment predates these harness changes and was not modified or rerun by this hardening work. Its results must retain these limitations:

- PGlite is in memory. Execution starts at frozen-source synthesis and excludes ingestion, actual worker admission, production database latency, and browser display.
- Search requests are live and uncached in this specific retained cohort; retrieved contents are not frozen across variants.
- Earlier generated briefs can contribute baseline history to later videos in the same trial. Before/after novelty inputs may therefore differ.
- Revision labels are supplied by that experiment; the old harness does not independently verify them.
- No resume/import path exists. Re-running its process repeats paid work.

Consequently its measurements are paired source-to-brief observations, not a fully controlled proof of algorithm-only improvement, full ingestion-to-display latency, or production capacity at 1,000 videos per day. The hardened reusable harness does not retroactively remove those limitations.
