import { z } from "zod";
/**
 * The listed instrument a reference resolves to, and how it was resolved. The
 * lookup itself runs on the server (server/youtube-intelligence/listings); this
 * is the shape stored on runs and shown in the UI.
 */
export const RESOLVED_BY = ["spoken_ticker", "alias", "verified_proposal", "registry_name"] as const;
export const ListingRef = z.object({
  symbol: z.string().nullable(),
  name: z.string(),
  market: z.string(),
  exchange: z.string().nullable(),
  method: z.enum(RESOLVED_BY),
  source: z.enum(["sec", "curated"]),
});
export type ListingRefData = z.infer<typeof ListingRef>;
