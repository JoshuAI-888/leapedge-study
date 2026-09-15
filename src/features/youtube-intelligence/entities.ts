import { z } from "zod";
import type { ClaimData, Run, CheckedClaim } from "./contracts.ts";
export const englishText = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (s) => !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s),
    "Use an English display name",
  );
export const Entity = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,100}$/),
    name: englishText,
    type: z.enum([
      "Company",
      "ETF",
      "Index",
      "Macro",
      "Sector",
      "Theme",
      "Commodity",
      "Unresolved",
    ]),
    aliases: z.array(z.string().trim().min(1).max(200)).max(100),
    topics: z.array(englishText).max(30),
    ticker: z
      .string()
      .regex(/^[A-Z0-9.^/-]{1,20}$/)
      .nullable(),
    exchange: z.string().max(50).nullable(),
    status: z.enum(["suggested", "reviewed"]),
    resolutionNote: z.string().min(5).max(2000),
  })
  .superRefine((v, c) => {
    if (
      v.ticker &&
      (!v.exchange ||
        v.status !== "reviewed" ||
        !["Company", "ETF", "Index"].includes(v.type))
    )
      c.addIssue({
        code: "custom",
        message:
          "Ticker requires reviewed identity, exchange and instrument type",
      });
  });
export type EntityData = z.infer<typeof Entity>;
export function aliasKey(s: string) {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s.,®™]/g, "");
}
export function displayEntity(c: ClaimData, registry: EntityData[]) {
  const topicAlias = `topic:${c.thesis_en.slice(0, 160)}`;
  const keys = [
    c.instrument_as_spoken,
    c.ticker,
    ...(!c.instrument_as_spoken && !c.ticker ? [topicAlias] : []),
  ]
    .filter(Boolean)
    .map((x) => aliasKey(x!));
  const matches = registry.filter((e) =>
    [
      e.name,
      ...e.aliases,
      ...(e.ticker ? [`${e.exchange}:${e.ticker}`] : []),
    ].some((a) => keys.includes(aliasKey(a))),
  );
  if (matches.length === 1) return matches[0];
  const raw = c.instrument_as_spoken || c.ticker;
  const name =
    raw && englishText.safeParse(raw).success
      ? raw
      : "Unresolved instrument or topic";
  return {
    id: "unresolved:" + aliasKey(raw || c.thesis_en),
    name,
    type: "Unresolved" as const,
    aliases: raw ? [raw] : [topicAlias],
    topics: [],
    ticker: null,
    exchange: null,
    status: "suggested" as const,
    resolutionNote:
      matches.length > 1
        ? "Ambiguous alias; review identity"
        : "No reviewed classification; ticker not inferred",
  };
}
export function entityCorpus(runs: Run[], registry: EntityData[]) {
  const groups = new Map<
    string,
    {
      entity: ReturnType<typeof displayEntity>;
      rows: { run: Run; item: CheckedClaim }[];
    }
  >();
  for (const run of runs)
    for (const item of [
      ...((run.output.claims || []) as CheckedClaim[]),
      ...((run.output.keyPoints || []) as CheckedClaim[]),
    ].filter((c) => c.passed)) {
      const entity = displayEntity(item.claim, registry);
      const g = groups.get(entity.id) || { entity, rows: [] };
      g.rows.push({ run, item });
      groups.set(entity.id, g);
    }
  return [...groups.values()].sort((a, b) => b.rows.length - a.rows.length);
}
