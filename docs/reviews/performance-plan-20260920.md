# Analysis performance build

Scope: instrument stage latency; interactive and finishing-brief queue priority with ageing; bounded independent extraction/search concurrency; bounded run-summary pages and lightweight activity refresh. Preserve audits, coverage, immutable paid responses and all existing UI functionality. No new LeapEdge analyses; no Finradar integration or hosted purchase.

Baseline commit: 140d6b2. The previous v8 cohort is historical context only (retained transcript replay, 75.77 seconds mean model work, 1239.30 seconds mean wall time); it is not the controlled before arm. Compare the same deterministic workloads on baseline and new code with identical concurrency, stage delays and database. Label fixture measurements separately from live-provider performance. Exercise long extraction split/restart, 100-job burst, manual queue priority, and UI summary/poll payload. Verify real PostgreSQL capacity/fencing and desktop/mobile browser behavior. Target 1000 videos/day and bursts of100; this build does not certify daily production capacity.

Implementation and measurement in progress. Final evidence will replace this status before completion.
