# Gemini Batch investigation — 21 October 2026

Status: in progress on `experiment/gemini-batch-20261021`, baseline `32a65994dcdd31f1e2caf1e86db2afaa75549c7b`.

This is an isolated investigation and bounded implementation experiment. Production defaults, deployment and automatic monitoring are outside scope. Additional live-test commitments are capped at US$5 or existing lower limits. Unknown submissions retain reservations and are never automatically resubmitted.

Execution: architecture and baseline → official API compatibility → offline regressions → one live feasibility request if current credentials and budgets permit → paired comparisons → economics and recommendation. No research-quality outcome is presumed.

Tests use the existing `submitBatchStage`, `pollBatch`, `modelCall`, `processNext`, queue, billing and source validation boundaries. No second orchestrator, model transport, source store or billing ledger is proposed.
