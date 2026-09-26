import { isVerifiedPrimaryHost, PRIMARY_DOMAIN_REGISTRY_VERSION } from "./primary-domain-registry.ts";
import { withProviderSlot } from "./provider-limits.ts";
import { createHash } from "node:crypto";
import { z } from "zod";
import { doc, put, runTeamPreferences } from "./research-store.ts";
import { get, reserve, settle, markUnknown } from "./store.ts";
import {
  ExternalEvidence,
  type ExternalEvidenceData,
} from "../../features/youtube-intelligence/research-brief.ts";
const Reply = z.object({
  requestId: z.string().optional(),
  costDollars: z.object({ total: z.number().nonnegative() }).optional(),
  results: z
    .array(
      z.object({
        url: z
          .url()
          .refine((value) =>
            ["https:", "http:"].includes(new URL(value).protocol),
          ),
        title: z.string().default(""),
        text: z.string().default(""),
        publishedDate: z.string().nullish(),
      }),
    )
    .max(20),
});
export function confirmedPublication(text: string, estimated: string | null) {
  if (!estimated || !Number.isFinite(Date.parse(estimated))) return null;
  const day = new Date(estimated).toISOString().slice(0, 10);
  // Only a publication/filing label at a line boundary counts. Fiscal periods,
  // quotes about another document, crawl dates and updated dates do not.
  const header = text.slice(0, 4500);
  const month = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?";
  const date = `(?:\\d{4}-\\d{2}-\\d{2}|${month} +\\d{1,2}(?:st|nd|rd|th)?[,]? +\\d{4}|\\d{1,2}(?:st|nd|rd|th)? +${month}[,]? +\\d{4})`;
  const pattern = new RegExp(`(?:^|\\n)[ \\t#*]*(?:published(?: on)?|release date|filed(?: on)?|filing date|for immediate release)[ \\t:–-]*(?:\\r?\\n[ \\t]*)?(${date})(?![\\d\\w])`, "gi");
  for (const match of header.matchAll(pattern)) {
    const normalized = match[1].replace(/(\d)(st|nd|rd|th)/gi, "$1").replace(/Sept\.?\b/gi, "Sep").replace(/\./g, "");
    const timestamp = Date.parse(normalized + " 12:00:00 GMT");
    const statedDay = /^\d{4}-/.test(normalized) ? Number(normalized.slice(8, 10)) : Number(normalized.match(/\b(\d{1,2})\b/)?.[1]);
    if (Number.isFinite(timestamp) && new Date(timestamp).getUTCDate() === statedDay && new Date(timestamp).toISOString().slice(0, 10) === day)
      return day + "T23:59:59.999Z";
  }
  return null;
}
export const RetrievalRecordSchema = z.object({
  key: z.string(),
  state: z.enum(["complete", "unavailable", "unknown"]),
  query: z.string(),
  timeMode: z.enum(["video_date", "current"]),
  sources: z.array(ExternalEvidence),
  costUsd: z.number().nonnegative().nullable(),
  costBasis: z.string(),
  requestId: z.string().optional(),
  note: z.string(),
  requestedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  ownershipRegistryVersion: z.string().optional(),
  cacheIdentity: z.object({
    version: z.enum(["exa-retrieval.v1", "exa-retrieval.v2"]),
    key: z.string().regex(/^[a-f0-9]{64}$/),
    runId: z.string().min(1),
    cutoff: z.iso.datetime(),
    since: z.iso.datetime().optional(),
    primaryDomains: z.array(z.string()),
  }).optional(),
  cache: z.object({
    version: z.enum(["exa-retrieval.v1", "exa-retrieval.v2"]),
    donorKey: z.string(),
    donorRunId: z.string(),
    donorCostUsd: z.number().nonnegative(),
    reusedAt: z.iso.datetime(),
  }).optional(),
});
export type RetrievalRecord = z.infer<typeof RetrievalRecordSchema>;
/** Recheck ownership on replay without refetching or altering retained paid records. */
export function reclassifyRetrievalOwnership(record: RetrievalRecord, domains: string[]): RetrievalRecord {
  return { ...record, ownershipRegistryVersion: PRIMARY_DOMAIN_REGISTRY_VERSION,
    sources: record.sources.map(source => ({ ...source, sourceClass: isVerifiedPrimaryHost(new URL(source.url).hostname, domains) ? "primary" : "unknown" })) };
}

const RetrievalInput = z.object({
  runId: z.string().min(1),
  query: z.string().min(1).max(400),
  timeMode: z.enum(["video_date", "current"]),
  cutoff: z.iso.datetime(),
  since: z.iso.datetime().optional(),
  primaryDomains: z.array(z.string().regex(/^[a-z0-9.-]+$/)).max(100),
  reuseCache: z.boolean().optional(),
}).refine((input) => !input.since || (input.timeMode === "current" && Date.parse(input.since) < Date.parse(input.cutoff)), { message: "since is allowed only for a current interval before cutoff" });
export async function retrieveResearchSources(input: {
  runId: string;
  query: string;
  timeMode: "video_date" | "current";
  cutoff: string;
  since?: string;
  primaryDomains: string[];
  reuseCache?: boolean;
}): Promise<RetrievalRecord> {
  input = RetrievalInput.parse(input);
  // The feature toggle is not part of paid-request identity: toggling cannot
  // rebuy an existing same-run unknown outcome.
  const { reuseCache, ...identity } = input;
  const key = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  const cacheKey = createHash("sha256").update(JSON.stringify({
    version: "exa-retrieval.v2", registryVersion: PRIMARY_DOMAIN_REGISTRY_VERSION, query: input.query, timeMode: input.timeMode,
    cutoff: input.cutoff, since: input.since ?? null, primaryDomains: [...new Set(input.primaryDomains)].sort(),
  })).digest("hex");
  const retained = await doc<RetrievalRecord>("researchRetrieval", key);
  if (retained) return reclassifyRetrievalOwnership(RetrievalRecordSchema.parse(retained), input.primaryDomains);
  const requestedAt = new Date().toISOString();
  const base = {
    ownershipRegistryVersion: PRIMARY_DOMAIN_REGISTRY_VERSION,
    key,
    query: input.query,
    timeMode: input.timeMode,
    sources: [],
    costUsd: null,
    costBasis: "provider costDollars.total, when supplied",
    requestedAt,
    cacheIdentity: {
      version: "exa-retrieval.v2" as const, key: cacheKey, runId: input.runId,
      cutoff: input.cutoff, ...(input.since ? { since: input.since } : {}), primaryDomains: [...new Set(input.primaryDomains)].sort(),
    },
  };
  if (reuseCache) {
    const pointer = z.object({ version: z.enum(["exa-retrieval.v1", "exa-retrieval.v2"]), donorKey: z.string(), donorRunId: z.string() }).safeParse(
      await doc("researchRetrievalCache", cacheKey),
    );
    if (pointer.success) {
      const donor = RetrievalRecordSchema.safeParse(await doc("researchRetrieval", pointer.data.donorKey));
      if (donor.success) {
        const record = donor.data;
        const age = record.completedAt ? Date.now() - Date.parse(record.completedAt) : Infinity;
        const ttl = input.timeMode === "current" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        const identityMatches = record.key === pointer.data.donorKey
          && record.query === input.query && record.timeMode === input.timeMode
          && record.cacheIdentity?.key === cacheKey
          && record.cacheIdentity.runId === pointer.data.donorRunId
          && record.cacheIdentity.version === "exa-retrieval.v2"
          && record.cacheIdentity.cutoff === input.cutoff
          && record.cacheIdentity.since === input.since
          && JSON.stringify(record.cacheIdentity.primaryDomains) === JSON.stringify(base.cacheIdentity.primaryDomains);
        if (identityMatches && record.state === "complete" && record.costUsd !== null && !record.cache && age >= 0 && age <= ttl) {
          if (!await get(input.runId)) throw Error("External verification requires a retained research run.");
          const hit: RetrievalRecord = { ...record, key, costUsd: 0,
            costBasis: "Retained retrieval reused; no provider request or consumer charge",
            requestedAt, completedAt: requestedAt,
            cache: { ...pointer.data, donorCostUsd: record.costUsd, reusedAt: requestedAt },
          };
          await put("researchRetrieval", key, hit);
          return hit;
        }
      }
    }
  }
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey)
    return {
      ...base,
      state: "unavailable",
      note: "EXA_API_KEY is not configured. No external facts were verified.",
    };
  const run = await get(input.runId);
  if (!run) throw Error("External verification requires a retained research run.");
  const settings = await runTeamPreferences(run);
  return withProviderSlot("exa", async () => {
    const reservation = await reserve(
      input.runId,
      `external-search-${key.slice(0, 16)}`,
      0.1,
      1,
      settings.budget.perVideoMaxUsd,
    );
    // A pre-request durable unknown record prevents a crash or timeout from buying
    // the same search twice. An operator may explicitly request a new revision.
    await put("researchRetrieval", key, {
      ...base,
      state: "unknown",
      note: "Request started; outcome not yet confirmed. Never automatically rebilled.",
    });
    try {
      const response = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          query:
            input.query +
            " primary sources official company investor relations filings",
          type: "auto",
          numResults: 3,
          endPublishedDate: input.cutoff,
          ...(input.since ? { startPublishedDate: input.since } : {}),
          ...(input.primaryDomains.length ? { includeDomains: [...new Set(input.primaryDomains)].sort() } : {}),
          contents: { text: { maxCharacters: 12000 } },
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw Error(`External search HTTP ${response.status}`);
      const data = Reply.parse(await response.json());
      const sources = data.results
        .filter((r) => r.text.trim())
        .map((r, index) => {
          const publishedAt = confirmedPublication(
            r.text,
            r.publishedDate ?? null,
          );
          const host = new URL(r.url).hostname.toLowerCase();
          const primary = isVerifiedPrimaryHost(host, input.primaryDomains);
          return ExternalEvidence.parse({
            id: `web-${key.slice(0, 10)}-${index}`,
            url: r.url,
            title: r.title,
            text: r.text.slice(0, 12000),
            publishedAt:
              publishedAt ??
              (r.publishedDate && Number.isFinite(Date.parse(r.publishedDate))
                ? new Date(r.publishedDate).toISOString()
                : null),
            retrievedAt: new Date().toISOString(),
            publicationConfirmed: !!publishedAt,
            dateBasis: publishedAt
              ? "Publication label in retained source; end-of-day cutoff conservatively applied"
              : "Provider estimated date only; excluded from synthesis",
            sourceClass: primary ? "primary" : "unknown",
            hash: createHash("sha256")
              .update(r.text.slice(0, 12000))
              .digest("hex"),
            query: input.query,
            timeMode: input.timeMode,
            provider: "Exa",
          });
        });
      const record: RetrievalRecord = {
        ...base,
        state: "complete",
        sources,
        costUsd: data.costDollars?.total ?? null,
        ...(data.requestId ? { requestId: data.requestId } : {}),
        note: "Search metadata alone does not establish publication time or factual corroboration. " + (input.primaryDomains.length ? "Search limited to the verified publisher-domain registry (exact approved hosts are classified primary); unlisted issuers and sources may be missed. This is not exhaustive verification." : "No primary-domain registry entries supplied; returned hosts are unverified and are not promoted to primary sources."),
        completedAt: new Date().toISOString(),
      };
      await settle(reservation, record.costUsd, {
        provider: "Exa",
        requestId: data.requestId ?? null,
        retrievalKey: key,
        costBasis: record.costBasis,
      });
      if (record.costUsd === null)
        await markUnknown(
          reservation,
          "External response did not report its charge.",
        );
      await put("researchRetrieval", key, record);
      // Index only successful known-charge donor records; never cache a cache
      // hit, extend freshness on reuse, or reuse uncertain paid outcomes.
      if (reuseCache && record.costUsd !== null) {
        // A best-effort reuse index must never downgrade a confirmed paid
        // response to an unknown outcome if its separate write fails.
        await put("researchRetrievalCache", cacheKey, { version: "exa-retrieval.v2", donorKey: key, donorRunId: input.runId }).catch(() => undefined);
      }
      return record;
    } catch (e) {
      const record: RetrievalRecord = {
        ...base,
        state: "unknown",
        note:
          e instanceof Error
            ? e.message
            : "External retrieval failed; cost unknown.",
      };
      await markUnknown(reservation, record.note);
      await put("researchRetrieval", key, record);
      return record;
    }
  });
}
