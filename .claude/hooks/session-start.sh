#!/bin/bash
# Boot a Claude Code on the web session ready to work: dependencies installed,
# and the delivery position printed so the session starts from the ledger
# rather than from guesswork.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# npm install, not npm ci: the container image is cached after this hook
# completes, so an incremental install is the one that benefits from it.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "Installing dependencies..."
  npm install --ignore-scripts --no-audit --no-fund
else
  echo "Dependencies already installed."
fi

# Read the ledger, not the last conversation. This is the one file that says
# where delivery stands; tests/delivery-ledger.test.ts keeps it honest.
if [ -f docs/delivery/ledger.json ]; then
  node -e '
    const l = require("./docs/delivery/ledger.json");
    const active = l.features.filter((f) => f.status !== "removed");
    const by = (s) => active.filter((f) => f.status === s).length;
    console.log(`\nDelivery ledger (${l.updated}): ${by("merged")} merged, ${by("in-review")} in review, ${by("todo")} to do, of ${active.length}.`);
    for (const phase of [0, 1, 2, 3, 4]) {
      const inPhase = active.filter((f) => f.phase === phase);
      if (!inPhase.length) continue;
      const done = inPhase.filter((f) => f.status === "merged").length;
      const next = inPhase.find((f) => f.status === "todo");
      console.log(`  phase ${phase}: ${done}/${inPhase.length} merged${next ? `  next: ${next.id} ${next.title}` : "  complete"}`);
    }
    const review = active.filter((f) => f.status === "in-review");
    if (review.length) {
      const prs = [...new Set(review.map((f) => f.pr))].join(", ");
      console.log(`  waiting on review: ${review.map((f) => f.id).join(", ")} (PR ${prs})`);
    }
    console.log("\nRead docs/delivery/ledger.json and AGENTS.md before changing anything.");
    console.log("Gates are advisory until the gold set lands: docs/gates/gate-debt.md\n");
  '
fi
