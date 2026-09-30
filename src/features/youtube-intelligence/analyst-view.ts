import { z } from "zod";
import type { CheckedClaim, ClaimData, MentionData } from "./contracts.ts";
import type { ListingRefData } from "./listing-ref.ts";
import type { ResearchBriefData } from "./research-brief.ts";

/**
 * The page a PM reads (analyst view, PR 3). Assembled by code from what the
 * pipeline already checked: accepted calls, accepted mentions, the audited
 * brief and the run's own doubts. No model call, so nothing here can add a
 * claim; it only merges, ranks, resolves and hides pipeline bookkeeping.
 */
const Quote = z.object({ text: z.string(), translation: z.string().nullable(), at: z.number().nullable() });
const Level = z.object({ kind: z.string(), value: z.string(), condition: z.string().nullable() });
export const IdeaCard = z.object({
  key: z.string(),
  ticker: z.string().nullable(),
  name: z.string(),
  spoken: z.string().nullable(),
  market: z.string().nullable(),
  resolvedBy: z.string().nullable(),
  action: z.string().nullable(),
  stance: z.string(),
  owner: z.enum(["creator", "guest", "third_party"]),
  ownerName: z.string().nullable(),
  conviction: z.string(),
  horizon: z.string().nullable(),
  thesis: z.string(),
  also: z.array(z.string()),
  levels: z.array(Level),
  option: z
    .object({ right: z.string(), side: z.string(), strike: z.string().nullable(), expiry: z.string().nullable(), premium: z.string().nullable() })
    .nullable(),
  size: z.string().nullable(),
  conditions: z.array(z.string()),
  risks: z.array(z.string()),
  catalysts: z.array(z.object({ text: z.string(), date: z.string().nullable() })),
  quote: Quote.nullable(),
  claimIds: z.array(z.string()),
});
export const SentimentRow = z.object({
  key: z.string(),
  ticker: z.string().nullable(),
  name: z.string(),
  sentiment: z.enum(["bullish", "bearish", "neutral", "mixed"]),
  mentions: z.number().int(),
  isCall: z.boolean(),
  owner: z.enum(["creator", "guest", "third_party"]),
  reasons: z.array(z.string()),
  firstAt: z.number().nullable(),
});
export const AnalystView = z.object({
  title: z.string(),
  channel: z.string().nullable(),
  publishedAt: z.string().nullable(),
  summary: z.array(z.object({ text: z.string(), at: z.number().nullable() })),
  stance: z.object({ bullish: z.number().int(), bearish: z.number().int(), neutral: z.number().int() }),
  ideas: z.array(IdeaCard),
  /** Instruments discussed without an idea card: resolved, with a clear stance or repeated mention. */
  sentiment: z.array(SentimentRow),
  /** Other names mentioned in passing, unresolved or once without a stance. */
  otherMentions: z.array(z.string()),
  themes: z.array(z.string()),
  keyPoints: z.array(z.object({ text: z.string(), at: z.number().nullable(), kind: z.string() })),
  numbers: z.array(z.object({ label: z.string(), quote: z.string(), at: z.number().nullable() })),
  notStated: z.array(z.string()),
  watchOuts: z.array(z.object({ text: z.string(), at: z.number().nullable() })),
  diagnostics: z.array(z.string()),
});
export type AnalystViewData = z.infer<typeof AnalystView>;
export type IdeaCardData = z.infer<typeof IdeaCard>;

export type AnalystViewInput = {
  title: string;
  channel: string | null;
  publishedAt: string | null;
  claims: CheckedClaim[];
  mentions: MentionData[];
  /** Mentions the critic accepted, by mention key; absent means not audited. */
  mentionChecks?: Record<string, boolean>;
  /** Resolved listing per claim id and per mention index, computed on the server. */
  claimListings: Record<string, ListingRefData | null>;
  mentionListings: (ListingRefData | null)[];
  brief: Pick<ResearchBriefData, "sentences" | "mainTopics" | "omissions" | "evidence"> | null;
  segmentSeconds: Record<string, number | null>;
  transcriptionDoubts: { heard: string; likely: string; reason_en: string; start_seconds?: number | null }[];
};

const ACTION_RANK: Record<string, number> = {
  bought: 0, sold: 0, plan_buy: 1, plan_sell: 1, holding: 2, avoid: 3, watch: 3, research: 3, view: 4,
};
const OWNER_RANK = { creator: 0, guest: 1, third_party: 2 } as const;
const CONVICTION_RANK: Record<string, number> = { high: 0, medium: 1, low: 2, unspecified: 3 };
const BULLISH = new Set(["long", "hold"]);
const BEARISH = new Set(["short", "avoid"]);
/**
 * What the video did not say is useful to a PM ("no price target for Celsius");
 * how the pipeline worked is not. Only a gap in the creator's own statements is
 * shown; everything else in the brief's omissions is a processing note.
 */
const NOT_STATED = /\b(not|never|no) (explicitly )?(stated|specified|provided|disclosed|detailed|given|mentioned|say|said)\b|does not (provide|give|say|specify|state)|(gives|provides|offers) no|no specific|were not stated|was not stated/i;
const PROCESS_WORDS = /\b(ASR|transcri\w*|metadata|verif\w*|corroborat\w*|external|audit|critique|recall|pipeline|baseline|this video run|calculation|ticker symbols?|speaker identit\w*|attribut\w*|withheld|threshold|chunk|source evidence|segment|timestamps?)\b|^[a-z]+-?\d+[:\s]/i;
const isGap = (o: string) => NOT_STATED.test(o) && !PROCESS_WORDS.test(o);

function instrumentKey(spoken: string | null, ref: ListingRefData | null) {
  if (ref) return ref.symbol ?? `private:${ref.name.toLowerCase()}`;
  return `said:${(spoken ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")}`;
}
/**
 * The sentences of a quote that name the instrument, at most about 280
 * characters, cut only at sentence ends so the words stay exactly as said.
 * Falls back to the opening sentences when the name is not found.
 */
export function excerpt(text: string, names: string[], limit = 180) {
  if (text.length <= limit) return text;
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]*\s*/gu) ?? [text];
  const lower = names.filter(Boolean).map((n) => n.toLowerCase());
  let start = sentences.findIndex((x) => lower.some((n) => x.toLowerCase().includes(n)));
  if (start < 0) start = 0;
  let out = "";
  for (let i = start; i < sentences.length && (out + sentences[i]).length <= limit; i++) out += sentences[i];
  if (!out) out = sentences[start].slice(0, limit);
  return `${start > 0 ? "… " : ""}${out.trim()}${out.trim().length < text.trim().length ? " …" : ""}`;
}
/** The numbers written in a text, compared as digit strings so a translation cannot change one. */
const digits = (t: string) => (t.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, "")).sort().join("|");
function quoteOf(claim: ClaimData, names: string[]): z.infer<typeof Quote> | null {
  const e = claim.evidence[0];
  if (!e) return null;
  // A translation whose numbers differ from the original is not shown: the
  // quote is evidence, and a changed figure inside quotation marks misleads.
  const faithful = e.quote_translation_en && digits(e.quote_translation_en) === digits(e.quote_original);
  const translation = faithful && e.quote_translation_en !== e.quote_original ? excerpt(e.quote_translation_en, names) : null;
  return { text: excerpt(e.quote_original, names), translation, at: e.source_span?.start_seconds ?? null };
}
/** Drop a catalyst whose text is contained in another's (same event, said twice). */
function dropContained<T extends { text: string; date: string | null }>(items: T[]) {
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
  return items.filter((k, i) =>
    !items.some((o, j) => j !== i && norm(o.text).includes(norm(k.text)) && (norm(o.text) !== norm(k.text) || j < i) && (o.date || !k.date)),
  );
}
const unique = <T,>(items: T[], key: (t: T) => string = (t) => JSON.stringify(t)) => {
  const seen = new Set<string>();
  return items.filter((t) => (seen.has(key(t)) ? false : (seen.add(key(t)), true)));
};

export function buildAnalystView(input: AnalystViewInput): AnalystViewData {
  // Ideas: accepted calls, one card per instrument, action and owner.
  const groups = new Map<string, { id: string; claim: ClaimData; ref: ListingRefData | null }[]>();
  for (const item of input.claims) {
    if (!item.passed) continue;
    const ref = input.claimListings[item.id] ?? null;
    const c = item.claim;
    const key = [instrumentKey(c.instrument_as_spoken ?? c.ticker, ref), c.owner ?? "creator"].join("|");
    groups.set(key, [...(groups.get(key) ?? []), { id: item.id, claim: c, ref }]);
  }
  const ideas: IdeaCardData[] = [...groups.entries()].map(([key, members]) => {
    // The strongest action leads the card; the other theses stay on it as "also".
    const sorted = [...members].sort(
      (a, b) =>
        (ACTION_RANK[a.claim.action ?? ""] ?? 4) - (ACTION_RANK[b.claim.action ?? ""] ?? 4) ||
        (CONVICTION_RANK[a.claim.creator_conviction] ?? 9) - (CONVICTION_RANK[b.claim.creator_conviction] ?? 9),
    );
    const lead = sorted[0];
    const c = lead.claim;
    const all = sorted.map((m) => m.claim);
    const option = all.find((x) => x.option)?.option ?? null;
    return {
      key,
      ticker: lead.ref?.symbol ?? c.ticker ?? null,
      name: lead.ref?.name ?? c.instrument_as_spoken ?? c.ticker ?? "Unnamed instrument",
      spoken: c.instrument_as_spoken ?? null,
      market: lead.ref?.market ?? null,
      resolvedBy: lead.ref?.method ?? (c.ticker ? "spoken_ticker" : null),
      action: c.action ?? null,
      stance: c.stance,
      owner: c.owner ?? "creator",
      ownerName: c.owner_name ?? null,
      conviction: c.creator_conviction,
      horizon: c.horizon_en,
      thesis: c.thesis_en,
      also: [],
      // A market capitalisation is not a price level a PM can trade on.
      levels: unique(
        all.flatMap((x) => x.levels.map((l) => ({ kind: l.kind, value: l.value_original, condition: l.condition_en ?? null }))),
        (l) => `${l.kind}|${l.value}`,
      ).filter((l) => !/\b(b|tr)illion\b|market cap|万亿|亿美元/i.test(l.value)),
      option: option
        ? { right: option.right, side: option.side, strike: option.strike_original, expiry: option.expiry_original, premium: option.premium_original }
        : null,
      size: all.find((x) => x.size_original)?.size_original ?? null,
      conditions: unique(all.flatMap((x) => x.conditions_en), (s) => s).slice(0, 2),
      risks: unique(all.flatMap((x) => x.risks_en), (s) => s).slice(0, 2),
      catalysts: dropContained(unique(all.flatMap((x) => (x.catalysts ?? []).map((k) => ({ text: k.text_en, date: k.date_original }))), (k) => k.text)),
      quote: quoteOf(c, [c.instrument_as_spoken ?? "", c.ticker ?? "", lead.ref?.symbol ?? ""]),
      claimIds: sorted.map((m) => m.id),
    };
  });
  // One third party's view on several instruments is one card, not one per
  // ticker (a fund manager's four shorts), so the creator's own ideas lead.
  const ideaKeys = new Set(ideas.map((i) => i.key.split("|")[0]));
  const merged: IdeaCardData[] = [];
  for (const idea of ideas) {
    const twin = idea.owner !== "creator" && idea.ownerName
      ? merged.find((m) => m.owner === idea.owner && m.ownerName === idea.ownerName && m.stance === idea.stance)
      : undefined;
    if (!twin) {
      merged.push(idea);
      continue;
    }
    twin.ticker = [twin.ticker ?? twin.name, idea.ticker ?? idea.name].join(", ");
    twin.name = twin.ticker;
    twin.claimIds.push(...idea.claimIds);
    twin.levels = unique([...twin.levels, ...idea.levels], (l) => `${l.kind}|${l.value}`);
    twin.risks = unique([...twin.risks, ...idea.risks], (r) => r).slice(0, 2);
  }
  ideas.length = 0;
  ideas.push(...merged);
  ideas.sort(
    (a, b) =>
      (ACTION_RANK[a.action ?? ""] ?? 4) - (ACTION_RANK[b.action ?? ""] ?? 4) ||
      OWNER_RANK[a.owner] - OWNER_RANK[b.owner] ||
      (CONVICTION_RANK[a.conviction] ?? 9) - (CONVICTION_RANK[b.conviction] ?? 9) ||
      (a.quote?.at ?? Infinity) - (b.quote?.at ?? Infinity),
  );

  // Ticker sentiment: one row per instrument, from accepted mentions.
  const claimOwner = new Map(input.claims.map((c) => [c.id, c.claim.owner ?? "creator"] as const));
  const rows = new Map<string, { m: MentionData; ref: ListingRefData | null }[]>();
  input.mentions.forEach((m, i) => {
    const check = input.mentionChecks?.[`${m.ticker ?? m.instrument_as_spoken}:${m.source_span.start_id}:${m.source_span.end_id}`];
    if (check === false) return;
    const ref = input.mentionListings[i] ?? null;
    const key = instrumentKey(m.instrument_as_spoken ?? m.ticker, ref);
    rows.set(key, [...(rows.get(key) ?? []), { m, ref }]);
  });
  const allRows = [...rows.entries()].map(([key, ms]) => {
    const kinds = new Set(ms.map((x) => x.m.sentiment));
    const owner = ms.map((x) => (x.m.claim_id ? claimOwner.get(x.m.claim_id) : undefined)).find(Boolean) ?? "creator";
    const ref = ms.find((x) => x.ref)?.ref ?? null;
    return {
      key,
      // Only a resolved symbol is shown as a ticker; a model's guess is not.
      ticker: ref?.symbol ?? null,
      resolved: Boolean(ref),
      name: ref?.name ?? ms[0].m.instrument_as_spoken,
      sentiment: (kinds.has("bullish") && kinds.has("bearish") ? "mixed" : kinds.has("bullish") ? "bullish" : kinds.has("bearish") ? "bearish" : "neutral") as "bullish" | "bearish" | "neutral" | "mixed",
      mentions: ms.length,
      isCall: ms.some((x) => x.m.is_call),
      owner,
      reasons: unique(ms.map((x) => x.m.rationale_en), (s) => s).slice(0, 2),
      firstAt: ms.reduce<number | null>((min, x) => {
        const t = x.m.source_span.start_seconds;
        return t == null ? min : min == null ? t : Math.min(min, t);
      }, null),
    };
  });
  // The cards already give each idea's direction, so the table covers the
  // rest: resolved instruments discussed more than in passing. Everything else
  // is one line of names, so noise never reads as a stance.
  const discussed = allRows.filter((r) => !ideaKeys.has(r.key));
  const shown = discussed
    .filter((r) => r.resolved && r.sentiment !== "neutral")
    .sort((a, b) => b.mentions - a.mentions || (a.firstAt ?? Infinity) - (b.firstAt ?? Infinity));
  const sentiment = shown.slice(0, 5).map(({ resolved, ...row }) => (void resolved, row));
  // An unresolved name is listed only when it reads as a name; lowercase
  // phrases are transcription noise ("wind stock"), not instruments.
  const otherMentions = unique(
    [...shown.slice(5), ...discussed.filter((r) => !shown.includes(r))]
      .filter((r) => r.resolved)
      .map((r) => r.ticker ?? r.name),
    (n) => n.toLowerCase(),
  );

  // Summary and key points from the audited brief, highest materiality first.
  const sentences = input.brief?.sentences ?? [];
  const evidenceAt = (ids: string[]) => {
    for (const id of ids) {
      const ev = input.brief?.evidence.find((e) => e.id === id) as { quotes?: { startId?: string }[] } | undefined;
      const start = ev?.quotes?.[0]?.startId;
      if (start && input.segmentSeconds[start] != null) return input.segmentSeconds[start]!;
    }
    return null;
  };
  const ranked = sentences
    .map((s, order) => ({ s, order }))
    .sort((a, b) => b.s.materiality - a.s.materiality || a.order - b.order);
  // The summary is the creator's own view first, three sentences that read on
  // their own (not one that opens by contrasting another), in video order.
  const KIND_RANK: Record<string, number> = { creator_view: 0, action: 1, holding: 2, analysis: 3, countercase: 4 };
  const CONNECTIVE = /^(In contrast|However|Meanwhile|Additionally|Also|Similarly|Conversely|On the other hand|Furthermore|Moreover|By contrast)\b/i;
  const summary = ranked
    .filter(({ s }) => s.kind in KIND_RANK && !CONNECTIVE.test(s.text))
    .sort((a, b) => b.s.materiality - a.s.materiality || KIND_RANK[a.s.kind] - KIND_RANK[b.s.kind] || a.order - b.order)
    .slice(0, 3)
    .sort((a, b) => a.order - b.order)
    .map(({ s }) => ({ text: s.text, at: evidenceAt(s.evidenceIds) }));
  const inSummary = new Set(summary.map((x) => x.text));
  // With idea cards on the page, the brief's action and holding sentences
  // would repeat them; key points keep the context around the ideas.
  const cardKinds = ideas.length ? new Set(["action", "holding"]) : new Set<string>();
  const keyPoints = ranked
    .filter(({ s }) => !inSummary.has(s.text) && !cardKinds.has(s.kind))
    .slice(0, 7)
    .sort((a, b) => a.order - b.order)
    .map(({ s }) => ({ text: s.text, at: evidenceAt(s.evidenceIds), kind: s.kind }));
  const numbers = unique(
    sentences.flatMap((s) => s.financialFacts.map((f) => ({ label: f.label, quote: f.quote, at: evidenceAt([f.evidenceId]) }))),
    (n) => n.label,
  ).slice(0, 8);

  const omissions = input.brief?.omissions ?? [];
  const doubts = unique(input.transcriptionDoubts, (d) => `${d.heard}|${d.likely}`);
  const numericDoubts = doubts.filter((d) => /\d/.test(d.heard));
  const wordDoubts = doubts.filter((d) => !/\d/.test(d.heard));
  const creatorIdeas = ideas.filter((i) => i.owner === "creator");
  return AnalystView.parse({
    title: input.title,
    channel: input.channel,
    publishedAt: input.publishedAt,
    summary,
    stance: {
      bullish: creatorIdeas.filter((i) => BULLISH.has(i.stance)).length,
      bearish: creatorIdeas.filter((i) => BEARISH.has(i.stance)).length,
      neutral: creatorIdeas.filter((i) => !BULLISH.has(i.stance) && !BEARISH.has(i.stance)).length,
    },
    ideas,
    sentiment,
    otherMentions,
    themes: (input.brief?.mainTopics ?? []).slice(0, 5),
    keyPoints,
    numbers,
    notStated: omissions.filter(isGap).slice(0, 3),
    // A misheard number changes meaning and is shown; a misspelt name is
    // already handled by listing resolution and stays in processing notes.
    watchOuts: numericDoubts.slice(0, 3).map((d) => ({
      text: `Possibly misheard: "${d.heard}" may be "${d.likely}". ${d.reason_en}`,
      at: d.start_seconds ?? null,
    })),
    diagnostics: [
      ...omissions.filter((o) => !isGap(o)),
      ...wordDoubts.map((d) => `Transcript spelling: "${d.heard}" is probably "${d.likely}".`),
    ],
  });
}

const clock = (s: number | null) =>
  s == null ? "" : ` [${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}]`;
const ACTION_LABEL: Record<string, string> = {
  bought: "Bought", sold: "Sold", holding: "Holding", plan_buy: "Plans to buy", plan_sell: "Plans to sell",
  watch: "Watching", research: "Researching", avoid: "Avoid", view: "View",
};

/** The view as plain text a PM can paste into a note; also what the benchmark judge reads. */
export function analystNote(v: AnalystViewData): string {
  const lines: string[] = [`# ${v.title}`, [v.channel, v.publishedAt?.slice(0, 10)].filter(Boolean).join(" · "), ""];
  if (v.summary.length) lines.push("## Summary", ...v.summary.map((s) => `- ${s.text}${clock(s.at)}`), "");
  const glance = atAGlance(v);
  if (glance) lines.push(`At a glance: ${glance}`, "");
  if (v.ideas.length) {
    lines.push("## Ideas");
    for (const i of v.ideas) {
      const who = i.owner === "creator" ? "" : ` — ${i.owner === "guest" ? "guest" : "third party"}${i.ownerName ? `: ${i.ownerName}` : ""}`;
      const doing = i.action ? `${ACTION_LABEL[i.action] ?? i.action} · ${i.stance}` : i.stance;
      lines.push(`### ${i.ticker ?? i.name}${i.ticker && i.name !== i.ticker ? ` (${i.name})` : ""} · ${doing} · conviction ${i.conviction}${who}`);
      lines.push(i.thesis);
      const facts = [
        i.option && `Option: ${i.option.side} ${i.option.right}${i.option.strike ? ` ${i.option.strike}` : ""}${i.option.expiry ? `, expiry ${i.option.expiry}` : ""}${i.option.premium ? `, premium ${i.option.premium}` : ""}`,
        i.size && `Size: ${i.size}`,
        i.levels.length && `Levels: ${i.levels.map((l) => `${l.kind} ${l.value}${l.condition ? ` (${l.condition})` : ""}`).join("; ")}`,
        i.horizon && `Horizon: ${i.horizon}`,
        i.conditions.length && `If: ${i.conditions.join("; ")}`,
        i.catalysts.length && `Catalysts: ${i.catalysts.map((k) => `${k.text}${k.date ? ` (${k.date})` : ""}`).join("; ")}`,
        i.risks.length && `Risks: ${i.risks.join("; ")}`,
        ...i.also.map((a) => `Also: ${a}`),
      ].filter(Boolean);
      lines.push(...facts.map((f) => `- ${f}`));
      // A PM reads the checked English; the original words stay on the page.
      if (i.quote) lines.push(`> "${i.quote.translation ?? i.quote.text}"${i.quote.translation ? " (translated)" : ""}${clock(i.quote.at)}`);
      lines.push("");
    }
  }
  if (v.sentiment.length) {
    lines.push("## Also discussed");
    for (const r of v.sentiment)
      lines.push(`- ${r.ticker ?? r.name}${r.owner !== "creator" ? " (third party)" : ""}: ${r.sentiment}. ${r.reasons[0] ?? ""}${clock(r.firstAt)}`);
    lines.push("");
  }
  if (v.otherMentions.length) lines.push(`Also mentioned: ${v.otherMentions.join(", ")}`, "");
  if (v.keyPoints.length) lines.push("## Key points", ...v.keyPoints.map((k) => `- ${k.text}${clock(k.at)}`), "");
  if (v.watchOuts.length) lines.push("## Watch-outs", ...v.watchOuts.map((w) => `- ${w.text}${clock(w.at)}`), "");
  return lines.join("\n").trim() + "\n";
}

/** One line a PM can read first: each idea's ticker grouped by what the creator did. */
export function atAGlance(v: AnalystViewData) {
  const groups = new Map<string, string[]>();
  for (const i of v.ideas) {
    const label = i.owner !== "creator" ? "Third-party view" : i.action ? ACTION_LABEL[i.action] ?? i.action : i.stance;
    groups.set(label, [...(groups.get(label) ?? []), i.ticker ?? i.name]);
  }
  return [...groups.entries()].map(([label, names]) => `${label}: ${unique(names, (n) => n).join(", ")}`).join(" · ");
}
