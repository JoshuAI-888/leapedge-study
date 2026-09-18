# Promptfoo evaluation boundary

14 September 2026 audit:

- Application dependency graph: zero reported advisories, including development dependencies.
- Production-only graph: zero reported advisories.
- Separate `evaluations/tooling` graph: seven high-severity affected packages, originating through optional model/security tooling. These are transitive dependency findings, not seven distinct direct Promptfoo vulnerabilities.

Affected chains include `@huggingface/transformers → onnxruntime-node → adm-zip`, `@huggingface/transformers → sharp`, and `@openai/codex-security → extract-zip`. Findings cover archive memory exhaustion, symlink traversal/file overwrite and inherited image-library vulnerabilities. npm's suggested automatic fix is a breaking downgrade to Promptfoo 0.120.14; it was not forced into the tested pipeline.

Promptfoo 0.123.0 is pinned in a separate package/lockfile. It is excluded from Vercel upload and app installation. Install with lifecycle scripts disabled, process only trusted local configuration, and do not start a public Promptfoo server or run unrelated archive/image/model-download providers. This isolation reduces exposure; it does not claim to patch those dependencies.

The supplied replay runner disables sharing/telemetry, uses a custom retained-output provider and records zero new model cost. It was exercised successfully after isolation: two expected passes and two expected failures, no evaluator errors. Exit code 1 for those known failing outputs is intentional.

The hosted app uses the shared pure grading functions directly for fresh A/B experiments; it never imports Promptfoo. Paid experiment generation remains behind the private app gate and budget ledger.
