/**
 * Submit fresh videos to the hosted app and record, per video, the same
 * measures taken for LeapEdge: time from submission to the analysis and to the
 * final brief, cost, and the published brief for side-by-side review.
 *
 *   YTI_BASE_URL=https://youtube-intel-delta.vercel.app YTI_PASSCODE=... \
 *   node --experimental-strip-types scripts/paired-comparison.ts videos.txt out.json
 *
 * videos.txt holds one YouTube URL per line. The research pipeline used is the
 * workspace's Settings choice at submission (select "v3 — faithful brief" for
 * the comparison). The LeapEdge side is recorded by hand in the same file under
 * `leapedge` for each video: submittedAt, readyAt, displayed cost and the report.
 * Nothing here judges which output is right.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const base = process.env.YTI_BASE_URL;
const code = process.env.YTI_PASSCODE;
const [list, out = "data/paired-comparison.json"] = process.argv.slice(2);
if (!base || !code || !list) throw Error("Set YTI_BASE_URL and YTI_PASSCODE and pass a file of video URLs.");
const origin = new URL(base).origin;

const login = await fetch(`${origin}/api/access`, {
  method: "POST",
  redirect: "manual",
  headers: { origin, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ code }).toString(),
});
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (login.status !== 303 || !cookie) throw Error(`Sign-in failed (${login.status}).`);
const api = async (path: string, body?: unknown) => {
  const r = await fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, origin, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await r.json();
  if (!r.ok) throw Error(`${path}: ${value.error ?? r.status}`);
  return value;
};

type Row = { url: string; runId?: string; submittedAt?: string; status?: string; timeline?: unknown; costUsd?: number; brief?: unknown; error?: string; leapedge?: unknown };
const rows: Row[] = existsSync(out)
  ? JSON.parse(readFileSync(out, "utf8"))
  : readFileSync(list, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((url) => ({ url }));
const save = () => writeFileSync(out, JSON.stringify(rows, null, 2));

for (const row of rows.filter((r) => !r.runId)) {
  try {
    const { run } = await api("/api/intelligence/runs", { url: row.url, model: "google/gemini-3.8-flash" });
    Object.assign(row, { runId: run.id, submittedAt: run.createdAt, status: run.status });
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
  }
  save();
}
const deadline = Date.now() + 60 * 60 * 1000;
while (Date.now() < deadline) {
  const pending = rows.filter((r) => r.runId && !(r.timeline as { complete?: boolean } | undefined)?.complete && !["failed"].includes(r.status ?? ""));
  if (!pending.length) break;
  for (const row of pending) {
    const detail = await api(`/api/intelligence/runs/${row.runId}`);
    Object.assign(row, {
      status: detail.run.status,
      timeline: detail.run.output.timeline,
      costUsd: detail.run.cost,
      brief: detail.researchBriefs?.[0] ?? null,
    });
  }
  save();
  console.log(rows.map((r) => `${r.url} ${r.status ?? r.error} ${(r.timeline as { endToEndSeconds?: number } | undefined)?.endToEndSeconds ?? "…"}s`).join("\n"));
  await new Promise((r) => setTimeout(r, 20000));
}
save();
console.log(`Wrote ${out}.`);
