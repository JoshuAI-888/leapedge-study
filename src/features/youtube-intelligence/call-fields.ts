/**
 * Display text for the structured-idea fields (prompt v9+) that call cards,
 * Search, Saved and exports show. The wording matches the analyst view's, so a
 * call reads the same wherever it appears.
 */
export const ACTION_LABELS: Record<string, string> = {
  bought: "Bought",
  sold: "Sold",
  holding: "Holding",
  plan_buy: "Plans to buy",
  plan_sell: "Plans to sell",
  watch: "Watching",
  research: "Researching",
  avoid: "Avoid",
  view: "View",
};
/** "Plans to buy" for plan_buy; an unknown value is shown as stored. */
export function actionText(action: string | null | undefined): string | null {
  if (!action) return null;
  return ACTION_LABELS[action] ?? action;
}
export type CatalystValue = { text: string; date: string | null };
/** "Q3 earnings (18 November)" — the date exactly as the creator said it. */
export function catalystText(c: CatalystValue): string {
  return c.date ? `${c.text} (${c.date})` : c.text;
}
/** A claim's catalysts in stored form, from the extraction's text_en/date_original. */
export function catalystsFromClaim(
  catalysts: { text_en: string; date_original: string | null }[] | undefined,
): CatalystValue[] {
  return (catalysts ?? []).map((c) => ({ text: c.text_en, date: c.date_original }));
}
