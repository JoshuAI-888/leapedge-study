import { z } from "zod";
/**
 * Label mapping between our Claim contract and the VideoConviction dataset
 * (gtfintechlab/VideoConviction, KDD 2025; CC BY-NC 4.0, non-commercial use
 * with attribution; see docs/videoconviction-dataset.md).
 *
 * Pure, dependency-free and unit-tested, in the same style as performance.ts
 * and trends.ts. Every function rejects values outside the closed enums with
 * a thrown error; the benchmark never scores a label it cannot name.
 *
 * Two label spaces are involved:
 *
 *  - Our Claim: `stance` (7-way) and `creator_conviction` (high|medium|low|
 *    unspecified).
 *  - VideoConviction: `action` as published in the CSV (Buy, Hold, Don't buy,
 *    Sell, Short sell, Unclear; null when `is_rec_present` is "No") and
 *    `conviction_score` (1, 2 or 3; null for no-rec rows).
 *
 * For scoring, both sides are projected onto a coarse action space
 * (buy|sell|hold|none) so a confusion matrix reads the same way as the
 * paper's, and the dataset label is also translated into our 7-way stance so
 * the harness can report strict stance agreement.
 *
 * Mapping table (also exported as data in MAPPING_TABLE):
 *
 *   Our stance     -> VC action   why
 *   long           -> buy         a directional buy call
 *   short          -> sell        a directional sell or short call
 *   avoid          -> sell        "don't buy" is the dataset's negative action
 *   hold           -> hold        keep the position
 *   neutral        -> hold        no directional change: the same instruction to a holder
 *   watch          -> none        a watch-list mention is not a recommendation
 *   conditional    -> none        a call that depends on a trigger is not yet a recommendation
 *
 *   VC label       -> our stance  why
 *   Buy            -> long
 *   Sell           -> short
 *   Short sell     -> short       we do not distinguish selling from shorting
 *   Hold           -> hold
 *   Don't buy      -> avoid
 *   Unclear        -> watch       lossy: the weakest stance, so precision is under-counted, never inflated
 *
 *   Our conviction <-> VC score
 *   high           <-> 3
 *   medium         <-> 2
 *   low            <-> 1
 *   unspecified    ->  null       the dataset has no "unspecified"; it never earns agreement
 */
export const YtiStance = z.enum([
  "long",
  "short",
  "neutral",
  "avoid",
  "watch",
  "hold",
  "conditional",
]);
export type YtiStance = z.infer<typeof YtiStance>;
export const YtiConviction = z.enum(["high", "medium", "low", "unspecified"]);
export type YtiConviction = z.infer<typeof YtiConviction>;
/** Coarse comparison space shared by both sides. */
export const VcAction = z.enum(["buy", "sell", "hold", "none"]);
export type VcAction = z.infer<typeof VcAction>;
/** Action labels exactly as published in the dataset CSV. */
export const VcDatasetAction = z.enum([
  "Buy",
  "Hold",
  "Don't buy",
  "Sell",
  "Short sell",
  "Unclear",
]);
export type VcDatasetAction = z.infer<typeof VcDatasetAction>;
export const VcConvictionScore = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type VcConvictionScore = z.infer<typeof VcConvictionScore>;
export type VcConvictionLabel = "low" | "medium" | "high";

export const STANCE_TO_ACTION: Record<YtiStance, VcAction> = {
  long: "buy",
  short: "sell",
  avoid: "sell",
  hold: "hold",
  neutral: "hold",
  watch: "none",
  conditional: "none",
};
export const DATASET_ACTION_TO_STANCE: Record<VcDatasetAction, YtiStance> = {
  Buy: "long",
  Sell: "short",
  "Short sell": "short",
  Hold: "hold",
  "Don't buy": "avoid",
  Unclear: "watch",
};
export const CONVICTION_TO_SCORE: Record<
  YtiConviction,
  VcConvictionScore | null
> = { high: 3, medium: 2, low: 1, unspecified: null };
export const SCORE_TO_CONVICTION: Record<VcConvictionScore, VcConvictionLabel> =
  { 1: "low", 2: "medium", 3: "high" };

/** The mapping as data, for documentation, hover text and the Lab panel. */
export const MAPPING_TABLE = {
  stanceToAction: [
    { stance: "long", action: "buy", why: "A directional buy call." },
    { stance: "short", action: "sell", why: "A directional sell or short call." },
    { stance: "avoid", action: "sell", why: "The dataset's negative action is Don't buy." },
    { stance: "hold", action: "hold", why: "Keep the position." },
    { stance: "neutral", action: "hold", why: "No directional change is the same instruction to a holder." },
    { stance: "watch", action: "none", why: "A watch-list mention is not a recommendation." },
    { stance: "conditional", action: "none", why: "A call that depends on a trigger is not yet a recommendation." },
  ] as const satisfies readonly { stance: YtiStance; action: VcAction; why: string }[],
  datasetActionToStance: [
    { label: "Buy", stance: "long", why: "Direct translation." },
    { label: "Sell", stance: "short", why: "Direct translation." },
    { label: "Short sell", stance: "short", why: "Selling and shorting are not distinguished in our stance." },
    { label: "Hold", stance: "hold", why: "Direct translation." },
    { label: "Don't buy", stance: "avoid", why: "Direct translation." },
    { label: "Unclear", stance: "watch", why: "Lossy; the weakest stance so precision is under-counted, never inflated." },
  ] as const satisfies readonly { label: VcDatasetAction; stance: YtiStance; why: string }[],
  conviction: [
    { conviction: "high", score: 3, why: "Top of the 1-3 scale." },
    { conviction: "medium", score: 2, why: "Middle of the 1-3 scale." },
    { conviction: "low", score: 1, why: "Bottom of the 1-3 scale." },
    { conviction: "unspecified", score: null, why: "The dataset has no unspecified bucket; it never earns agreement." },
  ] as const satisfies readonly { conviction: YtiConviction; score: VcConvictionScore | null; why: string }[],
};

function fail(kind: string, value: unknown): never {
  throw Error(`Unknown ${kind}: ${JSON.stringify(value)}`);
}
/** Our Claim stance to the coarse VideoConviction action. Throws on an unknown stance. */
export function stanceToAction(stance: unknown): VcAction {
  const s = YtiStance.safeParse(stance);
  return s.success ? STANCE_TO_ACTION[s.data] : fail("stance", stance);
}
const canonicalLabel = new Map(
  VcDatasetAction.options.map((l) => [l.toLowerCase(), l] as const),
);
/** Accepts the published spelling plus case and whitespace variants ("Don't Buy", "Short Sell"). */
export function canonicalDatasetAction(label: unknown): VcDatasetAction {
  const key = typeof label === "string" ? label.trim().toLowerCase() : "";
  return canonicalLabel.get(key) ?? fail("dataset action label", label);
}
/** Dataset action label to our stance. Throws on an unknown label. */
export function datasetActionToStance(label: unknown): YtiStance {
  return DATASET_ACTION_TO_STANCE[canonicalDatasetAction(label)];
}
/** Dataset action label to the coarse action, by way of the stance mapping so both directions agree. */
export function datasetActionToAction(label: unknown): VcAction {
  return stanceToAction(datasetActionToStance(label));
}
/** Our creator_conviction to the dataset's 1-3 score; unspecified has no score. Throws on an unknown value. */
export function convictionToScore(
  conviction: unknown,
): VcConvictionScore | null {
  const c = YtiConviction.safeParse(conviction);
  return c.success ? CONVICTION_TO_SCORE[c.data] : fail("conviction", conviction);
}
/** Dataset score to our conviction bucket; null and undefined (no-rec rows) give null. Throws on any other value. */
export function scoreToConviction(score: unknown): VcConvictionLabel | null {
  if (score === null || score === undefined) return null;
  const s = VcConvictionScore.safeParse(score);
  return s.success ? SCORE_TO_CONVICTION[s.data] : fail("conviction score", score);
}
/**
 * Format-only normalisation of a dataset ticker ("NYSE: WMT", "aapl ").
 * Deliberately not semantic correction: the paper's backtest repairs APPL to
 * AAPL, but a benchmark that silently repairs labels overstates ticker
 * accuracy. A wrong symbol stays wrong and the miss stays visible. Symbols
 * with footnote marks or other non-ticker characters ("AI†") give null,
 * which removes the row from the ticker denominator.
 */
export function normalizeVcTicker(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const parts = raw.trim().toUpperCase().split(":");
  const tail = parts[parts.length - 1].trim().split(/\s+/);
  const t = tail[tail.length - 1];
  return /^[A-Z0-9.^=-]{1,20}$/.test(t) ? t : null;
}
