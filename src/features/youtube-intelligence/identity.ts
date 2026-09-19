import { z } from "zod";
/** Curated exact company aliases; never infer an ETF from a sector/index or
 * resolve an ambiguous bare ticker. Sources are issuer investor relations. */
export const ListingIdentity = z.object({
  name: z.string(),
  ticker: z.string(),
  exchange: z.string(),
  sourceUrl: z.url(),
  asOf: z.string(),
  method: z.literal("company_alias"),
  captionTicker: z.string().nullable(),
});
const listings = [
  [
    "Adobe",
    "ADBE",
    "NASDAQ",
    ["Adobe", "Adobe Inc"],
    "https://www.sec.gov/Archives/edgar/data/796343/000079634326000003/adbe-20251128.htm",
  ],
  [
    "Oracle",
    "ORCL",
    "NYSE",
    ["Oracle", "Oracle Corporation"],
    "https://investor.oracle.com/faq/default.aspx?lang=en",
  ],
  [
    "Coherent",
    "COHR",
    "NYSE",
    ["Coherent", "Coherent Corp"],
    "https://ir.coherent.com/news-events/financial-releases",
  ],
  [
    "Lumentum",
    "LITE",
    "NASDAQ",
    ["Lumentum", "Lumentum Holdings", "Lumenum"],
    "https://investor.lumentum.com/resources/investor-faqs/default.aspx",
  ],
  [
    "Credo",
    "CRDO",
    "NASDAQ",
    ["Credo", "Credo Technology"],
    "https://investors.credosemi.com/news-events/news/news-details/2025/Credo-Technology-Group-Holding-Ltd-Reports-Second-Quarter-of-Fiscal-Year-2026-Financial-Results/default.aspx",
  ],
  [
    "CoreWeave",
    "CRWV",
    "NASDAQ",
    ["CoreWeave", "Cororeweave"],
    "https://investors.coreweave.com/overview/default.aspx",
  ],
  [
    "NVIDIA",
    "NVDA",
    "NASDAQ",
    ["NVIDIA", "Nvidia"],
    "https://investor.nvidia.com/investor-resources/faqs/",
  ],
  [
    "Meta Platforms",
    "META",
    "NASDAQ",
    ["Meta", "Meta Platforms", "Facebook"],
    "https://investor.atmeta.com/stock-info/default.aspx",
  ],
  [
    "ServiceNow",
    "NOW",
    "NYSE",
    ["ServiceNow", "Service Now"],
    "https://investor.servicenow.com/",
  ],
  [
    "Ondas",
    "ONDS",
    "NASDAQ",
    ["Ondas", "Ondas Holdings"],
    "https://www.ondas.com/company-overview",
  ],
] as const;
const key = (s: string) => s.trim().toLowerCase().replace(/[ .]/g, "");
export function resolveListing(
  instrument: string | null,
  captionTicker: string | null,
) {
  if (!instrument) return null;
  const matches = listings.filter((l) =>
    l[3].some((a) => key(a) === key(instrument)),
  );
  if (matches.length !== 1) return null;
  const [name, ticker, exchange, , sourceUrl] = matches[0];
  return ListingIdentity.parse({
    name,
    ticker,
    exchange,
    sourceUrl,
    asOf: "2026-09-20",
    method: "company_alias",
    captionTicker,
  });
}
