import { z } from "zod";
import type { CheckedClaim, ClaimData, MentionData } from "./contracts.ts";
import type { ListingRefData } from "./listing-ref.ts";
import { reviewFinancialFact, type ResearchBriefData } from "./research-brief.ts";
import { numericalSentenceDisposition } from "./research-numeric-check.ts";

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
const Reference = z.object({ evidenceId:z.string(), startId:z.string().nullable(), endId:z.string().nullable(), text:z.string(), at:z.number().nullable() });
const ReadingPoint = z.object({ id:z.string(), text:z.string(), topic:z.string(), kind:z.string(), speaker:z.string(), at:z.number().nullable(), references:z.array(Reference) });
export const AnalystView = z.object({
  heading: z.string().default("Research assessment"),
  publicationState: z.enum(["root_checked", "coverage_in_progress", "reviewed_brief"]).default("root_checked"),
  sections: z.array(z.object({ key:z.enum(["thesis","valuation","countercase","next_checks","evidence"]), title:z.string(), points:z.array(ReadingPoint) })).default([]),
  title: z.string(),
  channel: z.string().nullable(),
  publishedAt: z.string().nullable(),
  summary: z.array(z.object({ text: z.string(), at: z.number().nullable(), references:z.array(Reference).default([]) })),
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
export const CheckedFindings = z.object({revision:z.number().int().nonnegative(),view:AnalystView,note:z.string()});
export type AnalystViewData = z.infer<typeof AnalystView>;
export type IdeaCardData = z.infer<typeof IdeaCard>;

export type AnalystViewInput = {
  publicationState?: "root_checked" | "coverage_in_progress" | "reviewed_brief";
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
  /** The checked bottom line, when one was written: it replaces the selected summary sentences. */
  bottomLine?: { text: string; statementIds: string[] }[] | null;
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
const words = (t: string) => new Set(t.toLowerCase().match(/[\p{L}\p{N}$%.]{3,}/gu) ?? []);
function quoteOf(claim: ClaimData, names: string[]): z.infer<typeof Quote> | null {
  // The quote shown is the cited passage that best matches the thesis wording
  // (in English, through its translation), not just the first range cited.
  const thesis = words(claim.thesis_en);
  const overlap = (e: ClaimData["evidence"][number]) => {
    let n = 0;
    for (const w of words(`${e.quote_translation_en || ""} ${e.quote_original}`)) if (thesis.has(w)) n++;
    return n;
  };
  const e = [...claim.evidence].sort((a, b) => overlap(b) - overlap(a))[0];
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
    if (input.brief || !item.passed || item.reasons.length || item.audit?.verdict !== "accept") continue;
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
      also: unique(all.map(x=>x.thesis_en).filter(t=>t!==c.thesis_en)),
      // A market capitalisation is not a price level a PM can trade on.
      levels: unique(
        all.flatMap((x) => x.levels.map((l) => ({ kind: l.kind, value: l.value_original, condition: l.condition_en ?? null }))),
        (l) => `${l.kind}|${l.value}`,
      ).filter((l) => !/\b(b|tr)illion\b|market cap|万亿|亿美元/i.test(l.value)),
      option: option
        ? { right: option.right, side: option.side, strike: option.strike_original, expiry: option.expiry_original, premium: option.premium_original }
        : null,
      size: all.find((x) => x.size_original)?.size_original ?? null,
      conditions: unique(all.flatMap((x) => x.conditions_en), (s) => s),
      risks: unique(all.flatMap((x) => x.risks_en), (s) => s),
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
    twin.risks = unique([...twin.risks, ...idea.risks], (r) => r);
    twin.conditions = unique([...twin.conditions, ...idea.conditions]);
    twin.also = unique([...twin.also, idea.thesis, ...idea.also]);
  }
  ideas.length = 0;
  ideas.push(...merged);
  ideas.sort(
    (a, b) =>
      OWNER_RANK[a.owner] - OWNER_RANK[b.owner] ||
      (ACTION_RANK[a.action ?? ""] ?? 4) - (ACTION_RANK[b.action ?? ""] ?? 4) ||
      (CONVICTION_RANK[a.conviction] ?? 9) - (CONVICTION_RANK[b.conviction] ?? 9) ||
      (a.quote?.at ?? Infinity) - (b.quote?.at ?? Infinity),
  );

  // Ticker sentiment: one row per instrument, from accepted mentions.
  const claimOwner = new Map(input.claims.map((c) => [c.id, c.claim.owner ?? "creator"] as const));
  const rows = new Map<string, { m: MentionData; ref: ListingRefData | null }[]>();
  input.mentions.forEach((m, i) => {
    const check = input.mentionChecks?.[`${m.ticker ?? m.instrument_as_spoken}:${m.source_span.start_id}:${m.source_span.end_id}`];
    if (input.brief || check !== true) return;
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
      reasons: unique(ms.map((x) => x.m.rationale_en), (s) => s),
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

  // Only accepted child assertions enter a reviewed surface. Recheck legacy
  // numerical proposals rather than letting a root card restore rejected prose.
  const evidence = input.brief?.evidence ?? [];
  const sentences = (input.brief?.sentences ?? []).filter(sentence => {
    const unresolved = sentence.financialFacts.map(f=>reviewFinancialFact(f,
      evidence.filter(e=>e.id===f.evidenceId && sentence.evidenceIds.includes(e.id)).flatMap(e=>e.quotes.map(q=>q.text))))
      .filter(check=>check.status==="unresolved").map(check=>check.original);
    return numericalSentenceDisposition({...sentence,financialFacts:unresolved},evidence).status !== "neutral_repair_required";
  });
  const referencesFor = (ids:string[]) => unique(ids.flatMap(id=>{
    const ev = evidence.find(e=>e.id===id);
    return (ev?.quotes ?? []).map(q=>({evidenceId:id,startId:q.startId ?? null,endId:q.endId ?? null,text:q.text ?? "",at:q.startId ? input.segmentSeconds[q.startId] ?? null : null}));
  }));
  const evidenceAt = (ids:string[]) => {
    const refs = referencesFor(ids);
    // Several distinct ranges do not imply a precise single assertion timestamp.
    return refs.length===1 ? refs[0].at : null;
  };
  const ranked = sentences.map((s,order)=>({s,order})).sort((a,b)=>b.s.materiality-a.s.materiality || a.order-b.order);
  const mainTopic = input.brief?.mainTopics?.find(t=>sentences.some(s=>s.topic.toLowerCase()===t.toLowerCase())) ?? ranked[0]?.s.topic;
  const main = ranked.filter(({s})=>s.topic.toLowerCase()===mainTopic?.toLowerCase());
  const chosen:typeof ranked=[];
  const pick=(pool:typeof ranked,kinds:string[])=>{
    const item=pool.find(x=>kinds.includes(x.s.kind)&&!chosen.some(y=>y.s.id===x.s.id));
    if(item) chosen.push(item);
  };
  pick(main,["creator_view","action","holding"]);
  pick(main,["analysis","reported_fact","scenario"]);
  if(!chosen.some(x=>["analysis","reported_fact","scenario"].includes(x.s.kind))) pick(ranked,["analysis","reported_fact","scenario"]);
  pick(main,["countercase","invalidation","next_check"]);
  // Do not fill a missing countercase slot with a third favourable fact.
  if(!chosen.length) pick(main.length ? main : ranked,ranked.map(x=>x.s.kind));
  if(chosen.length<2 && !chosen.some(x=>["countercase","invalidation","next_check"].includes(x.s.kind)))
    pick(ranked,["countercase","invalidation","next_check"]);
  const acceptedIds=new Set(sentences.map(s=>s.id));
  const validBottomLine=(input.bottomLine ?? []).filter(b=>b.statementIds.length && b.statementIds.every(id=>acceptedIds.has(id)));
  // A checked aid may fill only a missing overview; the source-derived balanced
  // slots remain when available. Its referenced published assertions are retained.
  const summary = chosen.length ? chosen.map(({s})=>({text:s.text,at:evidenceAt(s.evidenceIds),references:referencesFor(s.evidenceIds)}))
    : validBottomLine.map(b=>{const ids=sentences.filter(s=>b.statementIds.includes(s.id)).flatMap(s=>s.evidenceIds);return {text:b.text,at:evidenceAt(ids),references:referencesFor(ids)};});
  const inSummary=new Set(summary.map(s=>s.text));
  const keyPoints=sentences.filter(s=>!inSummary.has(s.text)).map(s=>({text:s.text,at:evidenceAt(s.evidenceIds),kind:s.kind}));
  const point=(s:typeof sentences[number])=>({id:s.id,text:s.text,topic:s.topic,kind:s.kind,speaker:s.speaker,at:evidenceAt(s.evidenceIds),references:referencesFor(s.evidenceIds)});
  const sectionKey=(s:typeof sentences[number])=>["countercase","invalidation"].includes(s.kind) ? "countercase" : s.kind==="next_check" ? "next_checks" : s.kind==="scenario" || s.financialFacts.length>0 || /\b(?:valuation|multiple|price.to.earnings|earnings times)\b/i.test(s.text) ? "valuation" : "thesis";
  const sections:z.infer<typeof AnalystView>["sections"]=([ ["thesis","Thesis"], ["valuation","Valuation and scenario"], ["countercase","Countercase"], ["next_checks","Next checks"] ] as const)
    .map(([key,title])=>({key,title,points:sentences.filter(s=>sectionKey(s)===key).sort((a,b)=>Number(b.topic===mainTopic)-Number(a.topic===mainTopic)).map(point)}));
  sections.push({key:"evidence",title:"Evidence",points:sentences.map(point)});
  const lead=main.find(({s})=>["creator_view","action","holding"].includes(s.kind))?.s ?? main[0]?.s;
  const ref=Object.values(input.claimListings).find(r=>r && [r.symbol,r.name].some(n=>n?.toLowerCase()===mainTopic?.toLowerCase()))
    ?? input.claims.map(c=>({c,ref:input.claimListings[c.id]})).find(x=>x.ref && x.c.claim.instrument_as_spoken?.toLowerCase()===mainTopic?.toLowerCase())?.ref;
  const company=ref ? `${ref.symbol ? ref.symbol+" · " : ""}${mainTopic}` : mainTopic;
  const heading=company ? `${company} — ${lead?.text ?? "Checked research"}` : ideas[0] ? `${ideas[0].ticker ?? ideas[0].name} — ${ideas[0].thesis}` : input.title;
  const numbers=unique(sentences.flatMap(s=>s.financialFacts.map(f=>({label:f.label,quote:f.quote,at:evidenceAt([f.evidenceId])}))),n=>`${n.label}|${n.quote}`);

  const omissions = input.brief?.omissions ?? [];
  const doubts = unique(input.transcriptionDoubts, (d) => `${d.heard}|${d.likely}`);
  const numericDoubts = doubts.filter((d) => /\d/.test(d.heard));
  const wordDoubts = doubts.filter((d) => !/\d/.test(d.heard));
  const creatorIdeas = ideas.filter((i) => i.owner === "creator");
  return AnalystView.parse({
    title: input.title,
    heading,
    sections,
    publicationState: input.publicationState ?? (input.brief ? "reviewed_brief" : "root_checked"),
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
    themes: input.brief?.mainTopics ?? [],
    keyPoints,
    numbers,
    notStated: omissions.filter(isGap),
    // A misheard number changes meaning and is shown; a misspelt name is
    // already handled by listing resolution and stays in processing notes.
    watchOuts: numericDoubts.map((d) => ({
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
/** The stance a card header shows, or null when it only restates the action ("Watching · watch"). */
const RESTATES: Record<string, string> = { watch: "watch", research: "watch", holding: "hold", avoid: "avoid" };
export function headerStance(action: string | null | undefined, stance: string) {
  return action && RESTATES[action] === stance ? null : stance;
}

/** The view as plain text a PM can paste into a note; also what the benchmark judge reads. */
export function analystNote(v: AnalystViewData): string {
  // The note has one shape: a summary paragraph, the ideas, and the context
  // around them. Everything else is on the page, not in the note.
  if (v.publicationState !== "root_checked") {
    const lines=[`# ${v.heading}`,v.publicationState==="coverage_in_progress" ? "Checked findings — full-source coverage still in progress" : "Reviewed brief",""];
    if(v.summary.length) lines.push("## 30-second brief",...v.summary.map(s=>s.text),"");
    for(const section of v.sections.filter(s=>s.key!=="evidence" && s.points.length)) {
      lines.push(`## ${section.title}`,...section.points.map(p=>`${p.text}${p.references.length===1 ? clock(p.references[0].at) : ""}`),"");
    }
    if(v.notStated.length) lines.push("## Source gaps",...v.notStated,"");
    if(v.diagnostics.length || v.watchOuts.length) lines.push("## Limitations — review before relying on this brief",...v.diagnostics,...v.watchOuts.map(s=>s.text),"");
    return lines.join("\n").trim()+"\n";
  }
  const lines: string[] = [`# ${v.title}`, [v.channel, v.publishedAt?.slice(0, 10)].filter(Boolean).join(" · "), ""];
  if (v.summary.length) lines.push("## Summary", v.summary.map((s) => s.text).join(" "), "");
  if (v.ideas.length) {
    lines.push("## Ideas");
    for (const i of v.ideas) {
      const who = i.owner === "creator" ? "" : ` — ${i.owner === "guest" ? "guest" : "third party"}${i.ownerName ? `: ${i.ownerName}` : ""}`;
      const doing = [i.action && (ACTION_LABEL[i.action] ?? i.action), headerStance(i.action, i.stance)].filter(Boolean).join(" · ");
      lines.push(`### ${i.ticker ?? i.name}${i.ticker && i.name !== i.ticker ? ` (${i.name})` : ""} · ${doing} · conviction ${i.conviction}${who}`);
      lines.push(i.thesis,...i.also);
      const facts = [
        i.option && `Option: ${i.option.side} ${i.option.right}${i.option.strike ? ` ${i.option.strike}` : ""}${i.option.expiry ? `, expiry ${i.option.expiry}` : ""}${i.option.premium ? `, premium ${i.option.premium}` : ""}`,
        i.size && `Size: ${i.size}`,
        i.levels.length && `Levels: ${i.levels.map((l) => `${l.kind} ${l.value}${l.condition ? ` (${l.condition})` : ""}`).join("; ")}`,
        i.horizon && `Horizon: ${i.horizon}`,
        i.conditions.length && `If: ${i.conditions.join("; ")}`,
        i.catalysts.length && `Catalysts: ${i.catalysts.map((k) => `${k.text}${k.date ? ` (${k.date})` : ""}`).join("; ")}`,
        i.risks.length && `Risks: ${i.risks.join("; ")}`,
      ].filter(Boolean);
      lines.push(...facts.map((f) => `- ${f}`));
      // A PM reads the checked English; the original words stay on the page.
      if (i.quote) lines.push(`> "${i.quote.translation ?? i.quote.text}"${i.quote.translation ? " (translated)" : ""}${clock(i.quote.at)}`);
      lines.push("");
    }
  }
  // Brief sentences carry an approximate position; only card quotes, copied
  // from an exact span, are timestamped in the note.
  if (v.keyPoints.length) lines.push("## Key points", ...v.keyPoints.map((k) => `- ${k.text}`), "");
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
