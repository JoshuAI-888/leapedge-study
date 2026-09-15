import {
  displayEntity,
  type EntityData,
} from "../../features/youtube-intelligence/entities.ts";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import {
  canonicalRuns,
  accepted,
  preferences,
  put,
  docs,
  doc,
  researchDB,
} from "./research-store.ts";
import { type ClaimData } from "../../features/youtube-intelligence/contracts.ts";
export function localDay(at: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}
export type Briefing = {
  id: string;
  createdAt: string;
  date: string;
  timezone: string;
  kind: string;
  runIds: string[];
  groups: {
    ticker: string;
    agreement: string;
    calls: {
      runId: string;
      claimId: string;
      channel: string;
      claim: ClaimData;
    }[];
  }[];
  limitations: string[];
  summaryPoints?: {
    text_en: string;
    refs: {
      runId: string;
      claimId: string;
    }[];
    passed: boolean;
    reason: string | null;
  }[];
};
export async function buildBriefing(date?: string) {
  const p = await preferences(),
    day = date || localDay(new Date().toISOString(), p.timezone);
  const runs = (await canonicalRuns()).filter(
    (r) => localDay(r.createdAt, p.timezone) === day,
  );
  const registry = await docs<EntityData>("entity");
  const groups = new Map<string, Briefing["groups"][number]["calls"]>();
  for (const r of runs)
    for (const c of [
      ...accepted(r),
      ...(
        (r.output.keyPoints ||
          []) as import("../../features/youtube-intelligence/contracts.ts").CheckedClaim[]
      ).filter((c) => c.passed),
    ]) {
      const ticker = displayEntity(c.claim, registry).name;
      const group = groups.get(ticker) || [];
      group.push({
        runId: r.id,
        claimId: c.id,
        channel: String(
          (
            r.output.metadata as {
              channel?: string;
            }
          )?.channel || "Unknown",
        ),
        claim: c.claim,
      });
      groups.set(ticker, group);
    }
  const b: Briefing = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    date: day,
    timezone: p.timezone,
    kind: "evidence-linked deterministic digest",
    runIds: runs.map((r) => r.id),
    groups: [...groups].map(([ticker, calls]) => ({
      ticker,
      calls,
      agreement:
        new Set(calls.map((c) => c.channel)).size < 2
          ? "Single-channel evidence"
          : new Set(calls.map((c) => c.claim.stance)).size === 1
            ? "Direction agrees; theses may differ"
            : "Mixed directions; inspect horizons and conditions",
    })),
    limitations: [
      "Grouped retained claims; no additional model synthesis has been run.",
      "Agreement is a stance comparison, not independent confirmation of a thesis.",
      "Only completed analyses in this collection are included.",
    ],
  };
  await put("briefing", b.id, b);
  return b;
}
export async function shareBriefing(id: string) {
  const b = await doc<Briefing>("briefing", id);
  if (!b) throw Error("Briefing not found.");
  const token = randomBytes(32).toString("base64url"),
    hash = createHash("sha256").update(token).digest("hex"),
    shareId = randomUUID(),
    now = new Date();
  await (
    await researchDB()
  )
    .prepare("INSERT INTO yi_shares VALUES(?,?,?,?,?,NULL)")
    .run(
      hash,
      shareId,
      JSON.stringify(b),
      now.toISOString(),
      new Date(now.getTime() + 7 * 86400000).toISOString(),
    );
  return {
    id: shareId,
    path: `/share/${token}`,
    expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
  };
}
export async function readShare(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await (
    await researchDB()
  )
    .prepare(
      "SELECT snapshot FROM yi_shares WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?",
    )
    .get(
      createHash("sha256").update(token).digest("hex"),
      new Date().toISOString(),
    );
  return row ? (JSON.parse(String(row.snapshot)) as Briefing) : null;
}
export async function revokeShare(id: string) {
  const r = await (
    await researchDB()
  )
    .prepare(
      "UPDATE yi_shares SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
    )
    .run(new Date().toISOString(), id);
  return { revoked: !!r.changes };
}
export function digestDue(
  now: Date,
  p: {
    timezone: string;
    digestHour: number;
    digestEnabled: boolean;
  },
  sentDays: string[],
) {
  const day = localDay(now.toISOString(), p.timezone),
    hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: p.timezone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(now),
    );
  return p.digestEnabled && hour >= p.digestHour && !sentDays.includes(day)
    ? day
    : null;
}
export async function prepareScheduledDigest() {
  const p = await preferences();
  const day = digestDue(new Date(), p, []);
  if (!day) return null;
  const { queueBriefing } = await import("./briefing-pipeline.ts");
  return researchDB().transaction(async () => {
    const id = `${p.timezone}:${day}`;
    if (await doc("delivery", id)) return null;
    const briefing = await buildBriefing(day);
    const run = briefing.groups.length
      ? await queueBriefing(briefing.id)
      : null;
    return put("delivery", id, {
      id,
      date: day,
      briefingId: briefing.id,
      runId: run?.id,
      status: run ? "synthesizing" : "preview_ready",
      createdAt: new Date().toISOString(),
      reason: run
        ? "Awaiting audited synthesis"
        : "No completed research today; empty digest is explicit.",
    });
  });
}
export async function shareSelection(input: unknown) {
  const { z } = await import("zod");
  const selection = z
    .array(z.object({ runId: z.string().min(1), claimId: z.string().min(1) }))
    .min(1)
    .max(500)
    .parse(input);
  const p = await preferences();
  const available = (await canonicalRuns()).flatMap((run) =>
    accepted(run).map((item) => ({ run, item })),
  );
  const keys = new Set(
    selection.map((s) => JSON.stringify([s.runId, s.claimId])),
  );
  if (keys.size !== selection.length) throw Error("Duplicate share selection.");
  const rows = available.filter(({ run, item }) =>
    keys.has(JSON.stringify([run.id, item.id])),
  );
  if (rows.length !== selection.length)
    throw Error(
      "Selection changed or contains unpublished evidence. Refresh and review before sharing.",
    );
  if (!rows.length) throw Error("No matching accepted research to share.");
  const registry = await docs<EntityData>("entity");
  const groups = Object.entries(
    Object.groupBy(rows, (r) => displayEntity(r.item.claim, registry).name),
  ).map(([ticker, items]) => ({
    ticker,
    agreement: "Filtered research snapshot; inspect conditions and horizons",
    calls: items!.map(({ run, item }) => ({
      runId: run.id,
      claimId: item.id,
      channel: String(
        (run.output.metadata as { channel?: string })?.channel || "Unknown",
      ),
      claim: item.claim,
    })),
  }));
  const id = randomUUID();
  await put("briefing", id, {
    id,
    createdAt: new Date().toISOString(),
    date: localDay(new Date().toISOString(), p.timezone),
    timezone: p.timezone,
    kind: "Filtered trends snapshot",
    runIds: [...new Set(rows.map((r) => r.run.id))],
    groups,
    selection,
    limitations: [
      "Frozen selection from this private collection; no network-wide totals.",
      "Quotes are retained text, not independent audio verification.",
    ],
  });
  return shareBriefing(id);
}
