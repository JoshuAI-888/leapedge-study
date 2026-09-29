/**
 * The daily report (spec 7.6, F64): what creators said in one US trading
 * session, assembled deterministically from stored calls. Pure, so node:test
 * covers it and the page, the archive and Today's summary card share one
 * definition. The database reads are in server/youtube-intelligence/daily-report.ts.
 *
 * Definitions:
 * - A call belongs to the session its video's publish time falls in
 *   (`sessionFor`), so Friday-evening and weekend uploads are Monday's.
 * - "In focus" ranks instruments, macro themes and sectors included, by the
 *   number of distinct creators with a call on them, then by calls.
 * - A disagreement is an instrument with at least one bullish and one bearish
 *   call in the session.
 * - Nothing is synthesised for fewer than MIN_SYNTHESIS_VIDEOS videos.
 */
import type { SentimentData } from "./contracts.ts";
import { STANCE_SENTIMENT } from "./stance-sentiment.ts";
import { describeInstrument, type InstrumentKind } from "./instrument-kind.ts";
import {
  isTradingDay,
  nextSession,
  previousSession,
} from "./trading-day.ts";

export const MIN_SYNTHESIS_VIDEOS = 3;
export const REPORT_SENTIMENTS = ["bullish", "neutral", "bearish"] as const;
export type Split = Record<SentimentData, number>;

export type ReportCall = {
  /** The claims row id, `<run id>:<claim id>`. */
  id: string;
  runId: string;
  /** The claim id within its run, the Analysis page anchor. */
  claimId: string;
  videoId: string;
  videoTitle: string | null;
  channelId: string | null;
  channelTitle: string | null;
  instrument: string | null;
  ticker: string | null;
  stance: string;
  conviction: string;
  trustLevel: string;
  thesis: string;
  publishedAt: string | null;
  quote: {
    text: string;
    translation: string | null;
    startSeconds: number | null;
  } | null;
};
export type ReportVideo = {
  runId: string;
  videoId: string;
  title: string | null;
  channelId: string | null;
  channelTitle: string | null;
  publishedAt: string | null;
  ideas: number;
  sentiment: Split;
  instruments: string[];
};
export type SynthesisPoint = {
  text_en: string;
  refs: { runId: string; claimId: string }[];
  passed: boolean;
  reason: string | null;
};
export type SynthesisInput = {
  /** The newest synthesis run for the session, whatever its state. */
  latestRun: {
    id: string;
    status: string;
    error: string | null;
    createdAt: string;
  } | null;
  /** The newest completed synthesis, when one exists. */
  completed: {
    runId: string;
    briefingId: string;
    createdAt: string;
    model: string | null;
    runIds: string[];
    points: SynthesisPoint[];
  } | null;
};
export type Citation = {
  runId: string;
  claimId: string;
  channel: string;
  seconds: number | null;
  /** "Macro Mike ▶ 4:12". */
  label: string;
  href: string;
};
export type ReportPoint = {
  text: string;
  citations: Citation[];
  reason: string | null;
};
export type InFocusRow = {
  key: string;
  label: { ticker: string | null; instrument: string | null };
  kind: InstrumentKind;
  creators: number;
  calls: number;
  split: Split;
  creatorSplit: Split;
  /** Distinct creators in the previous session, null when it was not discussed. */
  previousCreators: number | null;
  /** The top thesis: highest conviction, then trust, then newest. */
  reason: string;
  reasonCall: string;
  callIds: string[];
};
export type Disagreement = {
  key: string;
  label: { ticker: string | null; instrument: string | null };
  bullish: ReportCall[];
  bearish: ReportCall[];
};
export type ReportState =
  | "empty"
  | "too-few-videos"
  | "not-synthesized"
  | "synthesizing"
  | "synthesis-failed"
  | "synthesized";
export type DailyReport = {
  session: string;
  previous: string;
  /** Null when the next session has not started yet. */
  next: string | null;
  /** The session that is open now or opens next. */
  current: string;
  generatedAt: string;
  state: ReportState;
  /** Plain-language explanation of the state. */
  stateNote: string;
  headline: { text: string; synthesized: boolean };
  videos: number;
  creators: number;
  calls: number;
  split: { calls: Split; creators: Split };
  themes: ReportPoint[];
  removed: ReportPoint[];
  synthesis: {
    status: "none" | "queued" | "running" | "failed" | "completed";
    runId: string | null;
    error: string | null;
    createdAt: string | null;
    /** Videos in the session that the completed synthesis did not cover. */
    newVideos: number;
  };
  inFocus: InFocusRow[];
  disagreements: Disagreement[];
  sources: ReportVideo[];
  callList: ReportCall[];
  /** Mean cost of past completed syntheses, when there are any. */
  costEstimate: { usd: number; basis: number } | null;
};
export type ArchiveEntry = {
  session: string;
  headline: string;
  synthesized: boolean;
  calls: number;
  videos: number;
  creators: number;
  split: Split;
};

const empty = (): Split => ({ bullish: 0, neutral: 0, bearish: 0 });
export function sentimentOfStance(stance: string): SentimentData {
  return (
    (STANCE_SENTIMENT as Record<string, SentimentData | null>)[stance] ??
    "neutral"
  );
}
/** The grouping key: ticker, crypto symbol or vocabulary label, else the spoken name. */
export function instrumentKey(call: {
  ticker: string | null;
  instrument: string | null;
}) {
  const d = describeInstrument(call);
  return d.canonical ?? (call.instrument?.trim() || null);
}
const creatorOf = (c: ReportCall) => c.channelId ?? `unknown:${c.runId}`;
const CONVICTION_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};
function strongest(a: ReportCall, b: ReportCall) {
  return (
    (CONVICTION_RANK[b.conviction] ?? 0) - (CONVICTION_RANK[a.conviction] ?? 0) ||
    b.trustLevel.localeCompare(a.trustLevel) ||
    (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") ||
    a.id.localeCompare(b.id)
  );
}

/** "4:12", "1:02:05"; null for an unknown offset. */
export function timestamp(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds))
    return null;
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}
export function analysisHref(runId: string, claimId: string) {
  return `/youtube-intelligence/analysis/${encodeURIComponent(runId)}#${encodeURIComponent(claimId)}`;
}
export function citationFor(
  ref: { runId: string; claimId: string },
  calls: ReportCall[],
): Citation {
  const call = calls.find(
    (c) => c.runId === ref.runId && c.claimId === ref.claimId,
  );
  const channel = call?.channelTitle || "Source";
  const seconds = call?.quote?.startSeconds ?? null;
  const at = timestamp(seconds);
  return {
    runId: ref.runId,
    claimId: ref.claimId,
    channel,
    seconds,
    label: at ? `${channel} ▶ ${at}` : `${channel} ▶`,
    href: analysisHref(ref.runId, ref.claimId),
  };
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
export function splitText(split: Split) {
  return `${split.bullish} ▲ · ${split.neutral} ● · ${split.bearish} ▼`;
}
/** "Creators lean bullish: 41 ▲ · 11 ● · 7 ▼ across 14 creators". */
export function deterministicHeadline(split: Split, creators: number) {
  const { bullish, neutral, bearish } = split;
  if (bullish + neutral + bearish === 0) return "No creator calls in this session";
  const lean =
    bullish > bearish && bullish >= neutral
      ? "Creators lean bullish"
      : bearish > bullish && bearish >= neutral
        ? "Creators lean bearish"
        : neutral > bullish && neutral > bearish
          ? "Creators are mostly neutral"
          : "Creators are split";
  return `${lean}: ${splitText(split)} across ${plural(creators, "creator")}`;
}
/** "4 ideas · 3 ▲ 1 ● · NVDA AVGO TSM" (F61's verdict line, until that lane's shared part lands). */
export function verdictLine(video: {
  ideas: number;
  sentiment: Split;
  instruments: string[];
}) {
  if (!video.ideas) return "No investable ideas";
  const parts = REPORT_SENTIMENTS.filter((s) => video.sentiment[s] > 0).map(
    (s) => `${video.sentiment[s]} ${s === "bullish" ? "▲" : s === "neutral" ? "●" : "▼"}`,
  );
  // Instruments arrive as grouping keys ("Rates"); show them as their labels.
  const names = video.instruments
    .slice(0, 3)
    .map((key) => describeInstrument({ ticker: key, macroTheme: key }).text)
    .join(" ");
  return [plural(video.ideas, "idea"), parts.join(" "), names]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The trading session a picked calendar date means: the date itself when it
 * trades, otherwise the session its uploads roll into (the next one), unless
 * that has not started yet, in which case the one before.
 */
export function snapSession(date: string, current: string) {
  if (isTradingDay(date)) return date > current ? current : date;
  const next = nextSession(date);
  return next > current ? previousSession(date) : next;
}

type Split2 = { calls: Split; creators: Split };
function splits(calls: ReportCall[]): Split2 {
  const callSplit = empty();
  const creatorSets: Record<SentimentData, Set<string>> = {
    bullish: new Set(),
    neutral: new Set(),
    bearish: new Set(),
  };
  for (const c of calls) {
    const s = sentimentOfStance(c.stance);
    callSplit[s]++;
    creatorSets[s].add(creatorOf(c));
  }
  return {
    calls: callSplit,
    creators: {
      bullish: creatorSets.bullish.size,
      neutral: creatorSets.neutral.size,
      bearish: creatorSets.bearish.size,
    },
  };
}
function groups(calls: ReportCall[]) {
  const map = new Map<string, ReportCall[]>();
  for (const c of calls) {
    const key = instrumentKey(c);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  return map;
}

/** Instruments ranked by distinct creators, then calls, then name. */
export function rankInFocus(
  calls: ReportCall[],
  previous: ReportCall[] = [],
): InFocusRow[] {
  const before = groups(previous);
  return [...groups(calls)]
    .map(([key, list]): InFocusRow => {
      const top = [...list].sort(strongest)[0];
      const s = splits(list);
      const prior = before.get(key);
      return {
        key,
        label: { ticker: top.ticker, instrument: top.instrument },
        kind: describeInstrument(top).kind,
        creators: new Set(list.map(creatorOf)).size,
        calls: list.length,
        split: s.calls,
        creatorSplit: s.creators,
        previousCreators: prior ? new Set(prior.map(creatorOf)).size : null,
        reason: top.thesis,
        reasonCall: top.id,
        callIds: list.map((c) => c.id),
      };
    })
    .sort(
      (a, b) =>
        b.creators - a.creators ||
        b.calls - a.calls ||
        a.key.localeCompare(b.key),
    );
}

/** Instruments with calls on both sides, most-contested first. */
export function findDisagreements(calls: ReportCall[]): Disagreement[] {
  return [...groups(calls)]
    .map(([key, list]) => {
      const side = (s: SentimentData) =>
        list.filter((c) => sentimentOfStance(c.stance) === s).sort(strongest);
      const top = [...list].sort(strongest)[0];
      return {
        key,
        label: { ticker: top.ticker, instrument: top.instrument },
        bullish: side("bullish"),
        bearish: side("bearish"),
      };
    })
    .filter((d) => d.bullish.length > 0 && d.bearish.length > 0)
    .sort(
      (a, b) =>
        Math.min(b.bullish.length, b.bearish.length) -
          Math.min(a.bullish.length, a.bearish.length) ||
        b.bullish.length + b.bearish.length - (a.bullish.length + a.bearish.length) ||
        a.key.localeCompare(b.key),
    );
}

export function assembleReport(input: {
  session: string;
  current: string;
  now: string;
  calls: ReportCall[];
  previousCalls: ReportCall[];
  videos: ReportVideo[];
  synthesis: SynthesisInput;
  costEstimate: DailyReport["costEstimate"];
}): DailyReport {
  const { session, calls, videos, synthesis } = input;
  const split = splits(calls);
  const creators = new Set(calls.map(creatorOf)).size;
  const videoCount = Math.max(
    videos.length,
    new Set(calls.map((c) => c.runId)).size,
  );
  const completed = synthesis.completed;
  const latest = synthesis.latestRun;
  const status: DailyReport["synthesis"]["status"] = !latest
    ? completed
      ? "completed"
      : "none"
    : latest.status === "queued"
      ? "queued"
      : latest.status === "running"
        ? "running"
        : latest.status === "failed"
          ? "failed"
          : completed
            ? "completed"
            : "none";
  const cite = (p: SynthesisPoint): ReportPoint => ({
    text: p.text_en,
    citations: p.refs.map((r) => citationFor(r, calls)),
    reason: p.reason,
  });
  const tooFew = videoCount < MIN_SYNTHESIS_VIDEOS;
  const themes =
    completed && !tooFew ? completed.points.filter((p) => p.passed).map(cite) : [];
  const removed =
    completed && !tooFew ? completed.points.filter((p) => !p.passed).map(cite) : [];
  const covered = new Set(completed?.runIds ?? []);
  const newVideos = completed
    ? videos.filter((v) => !covered.has(v.runId)).length
    : 0;
  const state: ReportState = !calls.length && !videos.length
    ? "empty"
    : tooFew
      ? "too-few-videos"
      : status === "queued" || status === "running"
        ? "synthesizing"
        : status === "failed"
          ? "synthesis-failed"
          : completed
            ? "synthesized"
            : "not-synthesized";
  const stateNote = {
    empty: "No analysed videos were published in this session.",
    "too-few-videos": `Only ${plural(videoCount, "video")} in this session. A cross-creator summary needs at least ${MIN_SYNTHESIS_VIDEOS}, so the calls are listed as they are.`,
    "not-synthesized":
      "Synthesis not generated yet. Everything below is counted directly from the stored calls.",
    synthesizing:
      "The synthesis is being written and checked against the sources. Counts below are final.",
    "synthesis-failed": `The synthesis did not finish${latest?.error ? `: ${latest.error}` : "."}`,
    synthesized: "Themes were written by a model and checked against the quoted sources.",
  }[state];
  const headline =
    !tooFew && themes.length
      ? { text: themes[0].text, synthesized: true }
      : { text: deterministicHeadline(split.calls, creators), synthesized: false };
  const next = nextSession(session);
  return {
    session,
    previous: previousSession(session),
    next: next <= input.current ? next : null,
    current: input.current,
    generatedAt: input.now,
    state,
    stateNote,
    headline,
    videos: videoCount,
    creators,
    calls: calls.length,
    split,
    themes,
    removed,
    synthesis: {
      status,
      runId: latest?.id ?? completed?.runId ?? null,
      error: status === "failed" ? (latest?.error ?? null) : null,
      createdAt: completed?.createdAt ?? null,
      newVideos,
    },
    inFocus: rankInFocus(calls, input.previousCalls),
    disagreements: findDisagreements(calls),
    sources: [...videos].sort(
      (a, b) =>
        b.ideas - a.ideas ||
        (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") ||
        a.runId.localeCompare(b.runId),
    ),
    callList: [...calls].sort(strongest),
    costEstimate: input.costEstimate,
  };
}

/**
 * Archive rows from each call's session, creator and sentiment, newest session
 * first. `headlines` supplies a synthesised headline where one exists.
 */
export function buildArchive(
  calls: { session: string; channelId: string | null; runId: string; stance: string }[],
  headlines: Map<string, string> = new Map(),
): ArchiveEntry[] {
  const bySession = new Map<
    string,
    { split: Split; creators: Set<string>; videos: Set<string>; calls: number }
  >();
  for (const c of calls) {
    const entry = bySession.get(c.session) ?? {
      split: empty(),
      creators: new Set<string>(),
      videos: new Set<string>(),
      calls: 0,
    };
    entry.split[sentimentOfStance(c.stance)]++;
    entry.creators.add(c.channelId ?? `unknown:${c.runId}`);
    entry.videos.add(c.runId);
    entry.calls++;
    bySession.set(c.session, entry);
  }
  return [...bySession]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([session, e]) => {
      // A synthesised headline shows only where the page would show one.
      const synthesized =
        e.videos.size >= MIN_SYNTHESIS_VIDEOS ? headlines.get(session) : undefined;
      return {
        session,
        headline: synthesized ?? deterministicHeadline(e.split, e.creators.size),
        synthesized: synthesized !== undefined,
        calls: e.calls,
        videos: e.videos.size,
        creators: e.creators.size,
        split: e.split,
      };
    });
}
