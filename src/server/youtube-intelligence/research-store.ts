import { canDropFailedAudit } from "../../features/youtube-intelligence/research-quality.ts";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { db, get, list, create } from "./store.ts";
import * as P from "./prompts.ts";
import bundledPrompts from "./prompt-versions.json" with { type: "json" };
import {
  MODELS,
  type CheckedClaim,
  type Run,
} from "../../features/youtube-intelligence/contracts.ts";
import {
  TeamPreferences,
  AccountPreferences,
  teamDefaults,
  resolveAccount,
  migrateLegacyPreferences,
  type TeamPreferencesData,
  type AccountPreferencesData,
} from "../../features/youtube-intelligence/settings.ts";
import { resolveTeam } from "./env.ts";
/**
 * A registry row is immutable, so the schema has to keep whatever a version
 * declares. `pointerEvidence` is the one behavioural flag a version carries
 * (spec 4.2): with it the extraction and synthesis prompts cite segment ID
 * ranges and the pipeline copies the source text itself. It is optional, so
 * every shipped version stays byte-identical and keeps the quote path.
 */
export const PromptVersion = z.object({
  id: z.string().regex(/^[a-zA-Z0-9._-]{3,100}$/),
  rationale: z.string().min(10).max(4000),
  transcribe: z.string().min(20).max(30000),
  extraction: z.string().min(20).max(30000),
  synthesis: z.string().min(20).max(30000),
  critique: z.string().min(20).max(30000),
  pointerEvidence: z.boolean().optional(),
});
export const Preferences = z.object({
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone"),
  model: z.enum(MODELS),
  criticModel: z.enum(MODELS),
  windowedTranscription: z.boolean().default(false),
  nativeGoogleExperimental: z.boolean().default(false),
  transcriptionModel: z
    .enum(["google/gemini-3.1-flash-lite", ...MODELS])
    .default("google/gemini-3.1-flash-lite"),
  promptVersion: z.string(),
  theme: z.enum(["light", "dark", "system"]),
  digestHour: z.number().int().min(0).max(23),
  digestEnabled: z.boolean(),
  autoPullEnabled: z.boolean(),
});
export type PreferencesData = z.infer<typeof Preferences>;
export function researchDB() {
  return db();
}
export async function docs<T = Record<string, unknown>>(
  kind: string,
): Promise<T[]> {
  return (
    await (
      await researchDB()
    )
      .prepare(
        "SELECT payload FROM yi_documents WHERE kind=? ORDER BY created_at DESC",
      )
      .all(kind)
  ).map((r) => JSON.parse(String(r.payload)));
}
export async function doc<T = Record<string, unknown>>(
  kind: string,
  id: string,
): Promise<T | null> {
  const row = await (
    await researchDB()
  )
    .prepare("SELECT payload FROM yi_documents WHERE kind=? AND id=?")
    .get(kind, id);
  return row ? JSON.parse(String(row.payload)) : null;
}
export async function event(kind: string, id: string, payload: unknown) {
  await (
    await researchDB()
  )
    .prepare("INSERT INTO yi_events VALUES(?,?,?,?,?)")
    .run(
      randomUUID(),
      kind,
      id,
      new Date().toISOString(),
      JSON.stringify(payload),
    );
}
/**
 * The most recent stored events of one kind, returned oldest first, so a
 * caller that folds them into a map keyed on the entity id ends up holding
 * the latest event per entity.
 */
export async function events<T = Record<string, unknown>>(
  kind: string,
  limit = 500,
): Promise<{ id: string; entityId: string; at: string; payload: T }[]> {
  return (
    await (
      await researchDB()
    )
      .prepare(
        "SELECT id,entity_id,at,payload FROM yi_events WHERE kind=? ORDER BY at DESC,id DESC LIMIT ?",
      )
      .all(kind, limit)
  )
    .reverse()
    .map((r) => ({
      id: String(r.id),
      entityId: String(r.entity_id),
      at: String(r.at),
      payload: JSON.parse(String(r.payload)) as T,
    }));
}
export async function put(kind: string, id: string, payload: unknown) {
  const d = await researchDB(),
    now = new Date().toISOString();
  return d.transaction(async () => {
    await d
      .prepare(
        "INSERT INTO yi_documents VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
      )
      .run(kind, id, JSON.stringify(payload), now, now);
    await d
      .prepare("INSERT INTO yi_events VALUES(?,?,?,?,?)")
      .run(randomUUID(), kind, id, now, JSON.stringify(payload));
    return payload;
  });
}
export async function promptVersions() {
  await seed();
  return (
    await (
      await researchDB()
    )
      .prepare(
        "SELECT payload,hash,created_at FROM yi_prompts ORDER BY created_at DESC",
      )
      .all()
  ).map((r) => ({
    ...JSON.parse(String(r.payload)),
    hash: r.hash,
    createdAt: r.created_at,
  }));
}
export async function addPrompt(input: unknown) {
  const p = PromptVersion.parse(input),
    hash = createHash("sha256")
      .update(
        // The flag joins the digest only when the version declares it, so the
        // hash of every already-published version is unchanged, while two
        // versions that differ only in pointer mode never share a hash.
        JSON.stringify([
          p.transcribe,
          p.extraction,
          p.synthesis,
          p.critique,
          ...(p.pointerEvidence === undefined ? [] : [p.pointerEvidence]),
        ]),
      )
      .digest("hex");
  await (
    await researchDB()
  )
    .prepare("INSERT INTO yi_prompts VALUES(?,?,?,?)")
    .run(p.id, hash, JSON.stringify(p), new Date().toISOString());
  return p;
}
async function seed() {
  if(process.env.YTI_PREVIEW_READ_ONLY === "true")return;
  await researchDB().transaction(async () => {
    for (const p of bundledPrompts)
      if (
        !(await researchDB()
          .prepare("SELECT id FROM yi_prompts WHERE id=?")
          .get(p.id))
      )
        await addPrompt(p);
  });
}
export async function prompt(id: string) {
  await seed();
  const row = await (
    await researchDB()
  )
    .prepare("SELECT payload FROM yi_prompts WHERE id=?")
    .get(id);
  if (!row) throw Error("Unknown prompt version.");
  return PromptVersion.parse(JSON.parse(String(row.payload)));
}
export async function preferences(): Promise<PreferencesData> {
  return Preferences.parse(
    (await doc<PreferencesData>("preferences", "default")) || {
      timezone: "Pacific/Auckland",
      model: MODELS[0],
      criticModel: "google/gemini-3.5-flash",
      transcriptionModel: "google/gemini-3.1-flash-lite",
      promptVersion: "evidence-first.web.v5",
      theme: "light",
      digestHour: 8,
      digestEnabled: false,
      autoPullEnabled: false,
    },
  );
}
export async function savePreferences(input: unknown) {
  const p = Preferences.parse(input);
  await prompt(p.promptVersion);
  return await put("preferences", "default", p);
}
// v2 settings (spec 6.2 / 6.3): one team document and one account document
// per account id. The old flat "preferences" document is migrated into them
// once, on first read; afterwards the two APIs live independently.
const TEAM_DOC = "teamPreferences",
  ACCOUNT_DOC = "accountPreferences",
  DEFAULT_ACCOUNT = "default";
async function migrateSettingsIfNeeded() {
  if (await doc(TEAM_DOC, DEFAULT_ACCOUNT)) return;
  const legacy = await doc<PreferencesData>("preferences", DEFAULT_ACCOUNT);
  if (!legacy || process.env.YTI_PREVIEW_READ_ONLY === "true") return;
  const migrated = migrateLegacyPreferences(legacy);
  await researchDB().transaction(async () => {
    if (await doc(TEAM_DOC, DEFAULT_ACCOUNT)) return;
    await put(TEAM_DOC, DEFAULT_ACCOUNT, migrated.team);
    if (!(await doc(ACCOUNT_DOC, DEFAULT_ACCOUNT)))
      await put(ACCOUNT_DOC, DEFAULT_ACCOUNT, migrated.account);
  });
}
/** Team preferences with the YTI_HARD_BUDGET_USD_MONTH ceiling applied. */
export async function teamPreferences(): Promise<TeamPreferencesData> {
  await migrateSettingsIfNeeded();
  const stored = await doc(TEAM_DOC, DEFAULT_ACCOUNT);
  return resolveTeam(stored ? TeamPreferences.parse(stored) : teamDefaults());
}
export async function saveTeamPreferences(input: unknown) {
  const team = resolveTeam(TeamPreferences.parse(input));
  await prompt(team.prompts.version);
  return (await put(TEAM_DOC, DEFAULT_ACCOUNT, team)) as TeamPreferencesData;
}
export async function accountPreferences(
  accountId: string = DEFAULT_ACCOUNT,
): Promise<AccountPreferencesData> {
  await migrateSettingsIfNeeded();
  const stored = await doc(ACCOUNT_DOC, accountId);
  return AccountPreferences.parse(stored ?? {});
}
export async function saveAccountPreferences(
  input: unknown,
  accountId: string = DEFAULT_ACCOUNT,
) {
  const account = AccountPreferences.parse(input);
  return (await put(ACCOUNT_DOC, accountId, account)) as AccountPreferencesData;
}
/** The viewer's account settings with every null filled from the team. */
export async function resolvedAccountPreferences(
  accountId: string = DEFAULT_ACCOUNT,
) {
  return resolveAccount(
    await teamPreferences(),
    await accountPreferences(accountId),
  );
}
export async function queue(
  videoId: string,
  source?: unknown,
  config?: Partial<PreferencesData>,
  experiment = false,
) {
  const p = { ...(await preferences()), ...config };
  const snapshot = await prompt(p.promptVersion);
  return await create(
    videoId,
    p.model,
    {
      ...(source ? { source } : {}),
      criticModel: p.criticModel,
      transcriptionModel: p.transcriptionModel,
      promptSnapshot: snapshot,
      experiment: experiment || p.nativeGoogleExperimental,
      pipelineVersion: "research.v5.institutional-candidate",
      inferenceConfig: { critiqueMaxTokens: 6000, reasoningEffort: "low" },
      transcriptionWindowSeconds: p.windowedTranscription ? 600 : 0,
      nativeGoogleExperimental: p.nativeGoogleExperimental,
    },
    p.promptVersion,
  );
}
export function accepted(r: Run): CheckedClaim[] {
  return r.status === "completed"
    ? ((r.output.claims || []) as CheckedClaim[]).filter((c) => c.passed)
    : [];
}
export async function canonicalRuns() {
  const selected = new Map(
    (
      await docs<{
        videoId: string;
        runId: string;
      }>("publication")
    ).map((p) => [p.videoId, p.runId]),
  );
  const seen = new Set<string>();
  const result = (await list()).filter((r) => {
    if (r.status !== "completed" || r.input.task || seen.has(r.videoId))
      return false;
    if (
      selected.has(r.videoId)
        ? selected.get(r.videoId) !== r.id
        : r.input.experiment === true
    )
      return false;
    seen.add(r.videoId);
    return true;
  });
  for (const r of process.env.YTI_PREVIEW_READ_ONLY === "true" ? [] : result) {
    await researchDB().transaction(async () => {
      if (!(await doc("forwardObservation", r.videoId)))
        await put("forwardObservation", r.videoId, {
          videoId: r.videoId,
          observedAt: new Date().toISOString(),
          run: r,
        });
    });
  }
  return result;
}
export async function publishRun(id: string) {
  const r = await get(id);
  if (!r || r.status !== "completed" || r.input.task)
    throw Error("Select a completed video analysis.");
  return await put("publication", r.videoId, {
    videoId: r.videoId,
    runId: id,
    at: new Date().toISOString(),
  });
}
export async function saveIdea(runId: string, claimId: string) {
  const r = await get(runId);
  if (!r) throw Error("Analysis not found.");
  const c = accepted(r).find((c) => c.id === claimId);
  if (!c) throw Error("Only accepted published claims can be saved.");
  const id = `${r.id}:${c.id}`,
    old = await doc("idea", id);
  if (old) return old;
  return await put("idea", id, {
    id,
    runId,
    claimId,
    title: r.title,
    videoId: r.videoId,
    channel: (
      r.output.metadata as {
        channel?: string;
      }
    )?.channel,
    claim: c.claim,
    sourceHash: r.output.sourceHash,
    analysisAt: r.createdAt,
    savedAt: new Date().toISOString(),
    status: "open",
    note: "",
  });
}
export async function changeIdea(input: unknown) {
  const a = z
    .object({
      id: z.string(),
      status: z.enum(["open", "done", "dismissed"]),
      note: z.string().max(4000).default(""),
    })
    .parse(input);
  const old = await doc("idea", a.id);
  if (!old) throw Error("Saved idea not found.");
  return await put("idea", a.id, { ...old, ...a });
}
export async function watch(input: unknown) {
  const a = z
    .object({
      ticker: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9.^=-]{1,20}$/),
      enabled: z.boolean(),
    })
    .parse(input);
  return await put("watchlist", a.ticker, a);
}
export async function comparison(input: unknown) {
  const a = z
      .object({
        leftId: z.string(),
        rightId: z.string(),
        hypothesis: z.string().min(5).max(4000),
      })
      .parse(input),
    left = await get(a.leftId),
    right = await get(a.rightId);
  if (!left || !right || left.id === right.id)
    throw Error("Choose two different existing analyses.");
  if (left.status !== "completed" || right.status !== "completed")
    throw Error("Both analyses must be completed.");
  const id = randomUUID();
  return await put("comparison", id, {
    id,
    ...a,
    createdAt: new Date().toISOString(),
    sameVideo: left.videoId === right.videoId,
    sameSource:
      !!left.output.sourceHash &&
      left.output.sourceHash === right.output.sourceHash,
    left,
    right,
    reviewStatus: "unreviewed",
  });
}
export async function review(input: unknown) {
  const a = z
    .object({
      comparisonId: z.string(),
      winner: z.enum(["left", "right", "tie", "inconclusive"]),
      accuracy: z.number().min(0).max(5),
      completeness: z.number().min(0).max(5),
      evidence: z.number().min(0).max(5),
      notes: z.string().min(20).max(12000),
      reviewer: z.string().min(1).max(100),
    })
    .parse(input);
  if (!(await doc("comparison", a.comparisonId)))
    throw Error("Comparison not found.");
  const id = randomUUID();
  return await put("review", id, { id, ...a, at: new Date().toISOString() });
}
export async function improvement(input: unknown) {
  const a = z
    .object({
      title: z.string().min(5).max(200),
      problem: z.string().min(10).max(5000),
      proposal: z.string().min(10).max(5000),
      outcome: z.string().max(5000).default("Not yet tested"),
      comparisonId: z.string().optional(),
      status: z.enum(["proposed", "testing", "accepted", "rejected"]),
    })
    .parse(input);
  if (a.comparisonId && !(await doc("comparison", a.comparisonId)))
    throw Error("Comparison not found.");
  if (a.status === "accepted" && !a.comparisonId)
    throw Error("Accepted improvements require a comparison.");
  const id = randomUUID();
  return await put("improvement", id, {
    id,
    ...a,
    at: new Date().toISOString(),
  });
}
export async function researchSnapshot() {
  const [allRuns, documents] = await Promise.all([
    list(),
    researchDB()
      .prepare("SELECT kind,payload FROM yi_documents ORDER BY created_at DESC")
      .all(),
  ]);
  async function readDocs<T = Record<string, unknown>>(
    kind: string,
  ): Promise<T[]> {
    return documents
      .filter((r) => r.kind === kind)
      .map((r) => JSON.parse(String(r.payload)));
  }
  return {
    references: await readDocs<{
      videoId: string;
      url: string;
      tradeIdeas: number;
      keyPoints: number;
      displayedCostUsd: number;
      displayedTokens: string;
      topics: string[];
      finding: string;
      limitations: string;
    }>("reference"),
    audioReviews: await readDocs("audioReview"),
    transcriptAccuracy: await readDocs("transcriptAccuracy"),
    captionBenchmarks: await readDocs("captionBenchmark"),
    experiments: await readDocs("experiment"),
    evaluations: await readDocs<{
      id: string;
      at: string;
      checkVersion: string;
      mode: string;
      newModelCostUsd: number;
      limitation: string;
      rows: {
        runId: string;
        videoId: string;
        model: string;
        promptVersion: string;
        pass: boolean;
        reason: string;
      }[];
    }>("evaluation"),
    captionAttempts: (await readDocs("managedCaptionAttempt"))
      .slice(0, 30)
      .map(({ source, payload, ...r }) => r),
    jobs: allRuns
      .filter((r) => r.input.task)
      .map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        stage: r.stage,
        error: r.error,
        cost: r.cost,
      })),
    integrations: {
      readOnly: process.env.YTI_PREVIEW_READ_ONLY === "true",
      youtube: !!process.env.YOUTUBE_API_KEY,
      openrouter: !!process.env.OPENROUTER_API_KEY,
      fmp: !!process.env.FMP_API_KEY,
      nativeCaptions: !!(
        process.env.SUPADATA_API_KEY || process.env.TRANSCRIPTAPI_API_KEY
      ),
      emailConfigured: !!(
        process.env.RESEND_API_KEY &&
        process.env.YTI_EMAIL_TO &&
        process.env.YTI_EMAIL_FROM
      ),
      hosted: !!process.env.YTI_APP_ORIGIN,
    },
    preferences: await preferences(),
    prompts: await promptVersions(),
    channels: await readDocs("channel"),
    ideas: await readDocs("idea"),
    watchlist: await readDocs("watchlist"),
    comparisons: await readDocs("comparison"),
    reviews: await readDocs("review"),
    improvements: await readDocs("improvement"),
    briefings: await readDocs("briefing"),
    deliveries: await readDocs("delivery"),
    entities:
      await docs<
        import("../../features/youtube-intelligence/entities.ts").EntityData
      >("entity"),
    channelCandidates: await docs("channelCandidate"),
    shares: await (
      await researchDB()
    )
      .prepare(
        "SELECT id,created_at,expires_at,revoked_at FROM yi_shares ORDER BY created_at DESC",
      )
      .all(),
    discoveries: (
      await (
        await researchDB()
      )
        .prepare(
          "SELECT * FROM yi_discoveries ORDER BY json_extract(payload, '$.publishedAt') DESC",
        )
        .all()
    ).map((r) => ({
      ...r,
      id: r.id,
      video_id: r.video_id,
      channel_id: r.channel_id,
      run_id: r.run_id,
      payload: JSON.parse(String(r.payload)),
    })),
    events: (
      await (
        await researchDB()
      )
        .prepare("SELECT * FROM yi_events ORDER BY at DESC LIMIT 100")
        .all()
    ).map((r) => ({
      ...r,
      id: r.id,
      video_id: r.video_id,
      channel_id: r.channel_id,
      run_id: r.run_id,
      payload: JSON.parse(String(r.payload)),
    })),
    calls: (
      await (await researchDB()).prepare("SELECT * FROM yi_calls").all()
    ).map((r) => ({
      ...r,
      id: r.id,
      run_id: r.run_id,
      stage: r.stage,
      status: r.status,
      amount: r.amount,
      metrics: JSON.parse(String(r.metrics)),
    })),
    evaluationRuns: allRuns
      .filter((r) => r.status === "completed" && !r.input.task)
      .map((r) => ({
        ...r,
        input: {},
        output: { ...r.output, source: undefined },
      })),
    runs: (await canonicalRuns()).map((r) => ({
      ...r,
      input: {},
      output: { ...r.output, source: undefined },
    })),
  };
}
/**
 * Recovery from a failed critique: drop the first point the critic never
 * answered and requeue the run. Since F15 the critic is asked once for the
 * whole run, so there is no per-claim cursor to advance; the dropped point
 * carries a reason from here, and a reason is what keeps the batched critic
 * from asking about it again.
 */
export async function continueAfterAuditFailure(id: string) {
  const r = await get(id);
  if (!r || !canDropFailedAudit(r))
    throw Error("Only a failed critique can use this recovery.");
  const all = [
      ...((r.output.claims || []) as CheckedClaim[]),
      ...((r.output.keyPoints || []) as CheckedClaim[]),
    ],
    index = all.findIndex((c) => !c.audit && !c.reasons.length);
  if (index < 0 || !all[index])
    throw Error("No failed point is available to drop.");
  all[index].passed = false;
  all[index].reasons.push(
    `Audit could not finish: ${r.error}. Dropped without retrying the paid call.`,
  );
  await (
    await researchDB()
  )
    .prepare(
      "UPDATE yi_runs SET output=?,status='queued',error=NULL,lease_until=0,lease_token=NULL WHERE id=? AND status='failed'",
    )
    .run(JSON.stringify(r.output), id);
  await event("audit_recovery", id, {
    droppedPoint: all[index].id,
    reason: r.error,
    at: new Date().toISOString(),
  });
  return { id, droppedPoint: all[index].id };
}
