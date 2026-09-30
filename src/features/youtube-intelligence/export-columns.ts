/**
 * The call export columns (F63), in file order. One list, used by the CSV
 * writer (server/youtube-intelligence/export.ts) and documented on the
 * Methodology page, so the two cannot drift. Kept free of server imports.
 */
export const EXPORT_COLUMNS = [
  { id: "call_id", description: "Stable call id: the run id and the call's number within that run." },
  { id: "session_date", description: "The US trading session the video belongs to (New York date; weekend, holiday and after-close uploads roll forward)." },
  { id: "published_at_utc", description: "When the video was published, in UTC (ISO 8601). Falls back to when it was analysed if YouTube gave no time." },
  { id: "channel_id", description: "YouTube channel id." },
  { id: "channel", description: "Channel name." },
  { id: "video_title", description: "Video title as published." },
  { id: "video_link", description: "YouTube link that starts at the first quoted evidence." },
  { id: "instrument", description: "Grouping key: ticker, crypto symbol, or the fixed macro or sector label (e.g. Rates)." },
  { id: "instrument_type", description: "stock, crypto, macro, sector or unresolved." },
  { id: "ticker", description: "Ticker as extracted, when one was named." },
  { id: "instrument_spoken", description: "The instrument as the creator said it." },
  { id: "stance", description: "long, short, neutral, avoid, watch, hold or conditional." },
  { id: "sentiment", description: "bullish, neutral or bearish, derived from the stance." },
  { id: "conviction", description: "The creator's stated certainty: high, medium, low or unspecified." },
  { id: "trust_level", description: "L0 to L3." },
  { id: "trust", description: "Trust name: Extracted, Text-checked, Audio-agreed or Human-verified. Trust describes the evidence, not investment quality." },
  { id: "thesis", description: "The call in one English sentence." },
  { id: "action", description: "What the creator says to do, when stated." },
  { id: "levels_original", description: "Price levels as the creator said them, as kind: wording, separated by semicolons." },
  { id: "levels_parsed", description: "The same levels read as numbers (a range as low–high); blank where the wording could not be read unambiguously." },
  { id: "catalysts", description: "Stated catalysts, separated by semicolons." },
  { id: "risks", description: "Stated risks, separated by semicolons." },
  { id: "conditions", description: "Conditions the call depends on, separated by semicolons." },
  { id: "horizon", description: "Stated time horizon." },
  { id: "expiry_date", description: "Stated expiry as a date (YYYY-MM-DD), when it could be read." },
  { id: "expiry_original", description: "Stated expiry in the creator's words." },
  { id: "quote_original", description: "The quoted evidence in the original language; several quotes are separated by \" | \"." },
  { id: "quote_translation", description: "English translation of the quoted evidence, in the same order." },
] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number]["id"];
/** Past this many rows the export menu says it is preparing the file. */
export const LARGE_EXPORT = 5000;
/** The most calls one export file holds; the file says when it was cut. */
export const EXPORT_CAP = 20000;
/** What the Export menu says it will export: "41 calls matching these filters". */
export function exportScope(total: number, filtered = true) {
  const n = `${total.toLocaleString("en-US")} ${total === 1 ? "call" : "calls"}`;
  if (total > EXPORT_CAP)
    return `The first ${EXPORT_CAP.toLocaleString("en-US")} of ${n}${filtered ? " matching these filters" : ""}`;
  return filtered ? `${n} matching these filters` : n;
}
