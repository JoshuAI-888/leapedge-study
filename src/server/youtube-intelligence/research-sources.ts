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
  const full = new Date(day + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const short = new Date(day + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const header = text.slice(0, 4500);
  for (const match of header.matchAll(
    /(?:published(?: on)?|release date|filed(?: on)?|filing date|for immediate release)[\s:–-]*([^\n]{0,100})/gi,
  )) {
    if ([day, full, short].some((d) => match[1].includes(d)))
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
});
export type RetrievalRecord = z.infer<typeof RetrievalRecordSchema>;
const RetrievalInput = z.object({
  runId: z.string().min(1),
  query: z.string().min(1).max(400),
  timeMode: z.enum(["video_date", "current"]),
  cutoff: z.iso.datetime(),
  primaryDomains: z.array(z.string().regex(/^[a-z0-9.-]+$/)).max(100),
});
export async function retrieveResearchSources(input: {
  runId: string;
  query: string;
  timeMode: "video_date" | "current";
  cutoff: string;
  primaryDomains: string[];
}): Promise<RetrievalRecord> {
  input = RetrievalInput.parse(input);
  const key = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const retained = await doc<RetrievalRecord>("researchRetrieval", key);
  if (retained) return RetrievalRecordSchema.parse(retained);
  const requestedAt = new Date().toISOString();
  const base = {
    key,
    query: input.query,
    timeMode: input.timeMode,
    sources: [],
    costUsd: null,
    costBasis: "provider costDollars.total, when supplied",
    requestedAt,
  };
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey)
    return {
      ...base,
      state: "unavailable",
      note: "EXA_API_KEY is not configured. No external facts were verified.",
    };
  const run = await get(input.runId);
  if (!run)
    throw Error("External verification requires a retained research run.");
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
          const primary = input.primaryDomains.some(
            (d) => host === d || host.endsWith("." + d),
          );
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
        note: "Search metadata alone does not establish publication time or factual corroboration.",
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
