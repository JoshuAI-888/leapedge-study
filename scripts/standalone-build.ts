/** Local delivery controller. It records checks; only reviewed delivery updates complete features. */
import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  openSync,
  closeSync,
} from "node:fs";
import { dirname, resolve, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";

/** Bind verification to the actual staged/working source, not just an old commit. */
export function codeSnapshotHash(root = process.cwd()) {
  const paths = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter((path) =>
      /^(src\/|scripts\/|tests\/|evaluations\/|package(?:-lock)?\.json$|tsconfig\.json$|next\.config\.)/.test(
        path,
      ),
    )
    .sort();
  const hash = createHash("sha256");
  for (const path of paths)
    if (existsSync(resolve(root, path)))
      hash
        .update(path)
        .update("\0")
        .update(readFileSync(resolve(root, path)))
        .update("\0");
  return hash.digest("hex");
}

const FeatureSchema = z.object({
  id: z.string(),
  title: z.string(),
  phase: z.number().int().nullable(),
  status: z.enum(["todo", "in-review", "merged", "removed"]),
  prereqs: z.array(z.string()),
});
const LedgerSchema = z.object({ features: z.array(FeatureSchema) });
export type Feature = z.infer<typeof FeatureSchema>;

export function selectWork(features: readonly Feature[]) {
  const complete = (f: Feature) =>
    f.status === "merged" || f.status === "removed";
  const phase =
    [2, 3].find((p) => features.some((f) => f.phase === p && !complete(f))) ??
    null;
  const byId = new Map(features.map((f) => [f.id, f]));
  const remaining = features.filter(
    (f) => phase !== null && f.phase === phase && !complete(f),
  );
  const ready = remaining.filter(
    (f) =>
      f.status === "todo" &&
      f.prereqs.every((id) => {
        const dependency = byId.get(id);
        return dependency !== undefined && complete(dependency);
      }),
  );
  return { phase, ready, blocked: remaining.filter((f) => !ready.includes(f)) };
}

export type Check = {
  id: string;
  program: "npm" | "node";
  args: string[];
  category: "required" | "legacy-diagnostic";
  env?: Record<string, string>;
};
export type CheckResult = {
  exitCode: number | null;
  signal: string | null;
  error?: string;
};

export function verificationPlan(offline: boolean): Check[] {
  return [
    { id: "tests", program: "npm", args: ["test"], category: "required" },
    {
      id: "pglite-tests",
      program: "npm",
      args: ["test"],
      category: "required",
      env: { YTI_DB: "pglite" },
    },
    {
      id: "typecheck",
      program: "npm",
      args: ["run", "typecheck"],
      category: "required",
    },
    {
      id: "build",
      program: "npm",
      args: ["run", "build"],
      category: "required",
    },
    ...(!offline
      ? [
          {
            id: "audit",
            program: "npm" as const,
            args: ["audit"],
            category: "required" as const,
          },
        ]
      : []),
    {
      id: "promotion-diagnostic",
      program: "node",
      args: [
        "--experimental-strip-types",
        "scripts/promotion-gate.ts",
        "--offline",
      ],
      category: "legacy-diagnostic",
    },
  ];
}

export async function runVerification(
  plan: Check[],
  execute: (check: Check) => Promise<CheckResult>,
) {
  const checks: (Check & CheckResult)[] = [];
  for (const check of plan) {
    let result: CheckResult;
    try {
      result = await execute(check);
    } catch (error) {
      result = { exitCode: null, signal: null, error: String(error) };
    }
    checks.push({ ...check, ...result });
    if (
      check.category === "required" &&
      (result.exitCode !== 0 || result.signal !== null || result.error)
    )
      break;
  }
  return {
    commandChecksPassed: plan
      .filter((c) => c.category === "required")
      .every((c) =>
        checks.some(
          (r) =>
            r.id === c.id && r.exitCode === 0 && r.signal === null && !r.error,
        ),
      ),
    featureCompletion: "not-assessed" as const,
    browser: "not-run" as const,
    realPostgres: "not-run" as const,
    leapedgeComparison: "not-run" as const,
    audit: plan.some((c) => c.id === "audit")
      ? "see-check-results"
      : "skipped-explicit-offline",
    checks,
  };
}

// Invoke npm's JavaScript entry point through Node, avoiding cmd.exe and shell quoting.
function npmEntry() {
  const candidates = [
    process.env.npm_execpath,
    ...(process.env.PATH ?? "")
      .split(delimiter)
      .flatMap((path) => [
        resolve(path, "node_modules/npm/bin/npm-cli.js"),
        resolve(path, "../lib/node_modules/npm/bin/npm-cli.js"),
        ...(process.platform === "win32" ? [] : [resolve(path, "npm")]),
      ]),
  ];
  const entry = candidates.find((path) => path && existsSync(path));
  if (!entry)
    throw new Error(
      "Cannot find npm's JavaScript entry point on PATH; set npm_execpath to npm-cli.js",
    );
  return entry;
}

async function main() {
  const Args = z
    .tuple([z.enum(["status", "next", "verify"])])
    .rest(z.literal("--offline"));
  const [command, ...flags] = Args.parse(process.argv.slice(2));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const ledgerText = readFileSync(
    resolve(root, "docs/delivery/ledger.json"),
    "utf8",
  );
  const ledger = LedgerSchema.parse(JSON.parse(ledgerText));
  const work = selectWork(ledger.features);
  if (command !== "verify") {
    console.log(
      JSON.stringify(
        {
          scope:
            "Standalone only: phase 2 then phase 3; stop before Finradar phase 4",
          ...work,
          ...(command === "status"
            ? {
                counts: [2, 3].map((phase) => ({
                  phase,
                  merged: ledger.features.filter(
                    (f) => f.phase === phase && f.status === "merged",
                  ).length,
                  inReview: ledger.features.filter(
                    (f) => f.phase === phase && f.status === "in-review",
                  ).length,
                  todo: ledger.features.filter(
                    (f) => f.phase === phase && f.status === "todo",
                  ).length,
                  active: ledger.features.filter(
                    (f) => f.phase === phase && f.status !== "removed",
                  ).length,
                })),
              }
            : {}),
          message:
            work.phase === null
              ? "No remaining standalone ledger items. Runtime and visual acceptance still require evidence."
              : work.ready.length
                ? "Implement and review eligible work, verify, then update the ledger honestly."
                : "Finish acceptance and review for the current phase; merge counts deliberately exclude unmerged branch work.",
        },
        null,
        2,
      ),
    );
    return;
  }
  const startedAt = new Date().toISOString();
  const directory = resolve(
    root,
    "data/build-loop",
    `${startedAt.replaceAll(":", "-")}-${randomUUID()}`,
  );
  mkdirSync(directory, { recursive: true });
  const report = await runVerification(
    verificationPlan(flags.includes("--offline")),
    (check) =>
      new Promise((resolveResult) => {
        const log = openSync(resolve(directory, `${check.id}.log`), "w", 0o600);
        let child;
        try {
          child = spawn(
            process.execPath,
            check.program === "npm" ? [npmEntry()!, ...check.args] : check.args,
            {
              cwd: root,
              shell: false,
              env: { ...process.env, ...check.env },
              stdio: ["ignore", log, log],
            },
          );
        } catch (error) {
          closeSync(log);
          throw error;
        }
        closeSync(log);
        console.log(
          `Running ${check.id}; log: ${resolve(directory, `${check.id}.log`)}`,
        );
        child.once("error", (error) =>
          resolveResult({ exitCode: null, signal: null, error: String(error) }),
        );
        child.once("close", (exitCode, signal) =>
          resolveResult({ exitCode, signal }),
        );
      }),
  );
  const evidence = {
    version: "standalone-build.v1",
    codeSnapshotSha256: codeSnapshotHash(root),
    startedAt,
    finishedAt: new Date().toISOString(),
    ledgerSha256: createHash("sha256").update(ledgerText).digest("hex"),
    ...report,
  };
  writeFileSync(
    resolve(directory, "report.json"),
    JSON.stringify(evidence, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({ ...evidence, evidenceDirectory: directory }, null, 2),
  );
  process.exitCode = report.commandChecksPassed ? 0 : 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
