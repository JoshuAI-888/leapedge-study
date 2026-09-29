import type { ClaimData } from "./contracts.ts";

/**
 * Keep only structured idea detail (prompt v9) that was actually said. Each
 * value copied from speech (option strike, expiry and premium, position size,
 * catalyst date, a named owner) must appear in the claim's copied evidence,
 * ignoring case and spacing. A value that does not is removed and recorded;
 * the call itself is kept, because a missing detail is a gap, not a reason to
 * lose the idea. Levels keep their stricter rule in validateClaim.
 */
export type RemovedDetail = { field: string; value: string; reason: string };

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function normalizeIdeaDetail(claim: ClaimData): { claim: ClaimData; removed: RemovedDetail[] } {
  const said = claim.evidence.map((e) => norm(e.quote_original));
  const present = (value: string) => said.some((q) => q.includes(norm(value)));
  const removed: RemovedDetail[] = [];
  const keep = (field: string, value: string | null | undefined) => {
    if (value == null || value === "") return value ?? null;
    if (present(value)) return value;
    removed.push({ field, value, reason: "Not present verbatim in the cited evidence." });
    return null;
  };
  const next: ClaimData = { ...claim };
  if (claim.option)
    next.option = {
      ...claim.option,
      strike_original: keep("option.strike_original", claim.option.strike_original),
      expiry_original: keep("option.expiry_original", claim.option.expiry_original),
      premium_original: keep("option.premium_original", claim.option.premium_original),
    };
  if (claim.size_original !== undefined) next.size_original = keep("size_original", claim.size_original);
  if (claim.catalysts)
    next.catalysts = claim.catalysts.map((c, i) => ({
      ...c,
      date_original: keep(`catalysts[${i}].date_original`, c.date_original),
    }));
  if (claim.owner_name !== undefined) next.owner_name = keep("owner_name", claim.owner_name);
  return { claim: removed.length ? next : claim, removed };
}
