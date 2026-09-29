/**
 * Refresh the SEC ticker snapshot the listing resolver reads.
 *
 *   SEC_USER_AGENT="Your Name your@email" \
 *   node --experimental-strip-types scripts/refresh-sec-listings.ts
 *
 * SEC asks automated clients to identify themselves with a contact in the
 * User-Agent and refuses requests without one, so the contact is yours to
 * supply; nothing here defaults it. Review the diff before committing: a
 * delisted ticker disappears and tests/listing-resolution.test.ts fails if a
 * curated alias still points at it.
 */
import { writeFileSync } from "node:fs";

const agent = process.env.SEC_USER_AGENT;
if (!agent) throw Error("Set SEC_USER_AGENT to a name and contact email; SEC rejects anonymous requests.");
const url = "https://www.sec.gov/files/company_tickers_exchange.json";
const response = await fetch(url, { headers: { "user-agent": agent } });
if (!response.ok) throw Error(`SEC ${response.status}`);
const body = (await response.json()) as { fields: string[]; data: [number, string, string, string | null][] };
const rows = body.data
  .filter((r) => r[2] && r[1])
  .map((r) => [r[2], r[1], r[3]] as const)
  .sort((a, b) => (a[0] < b[0] ? -1 : 1));
const out = "src/server/youtube-intelligence/listings/sec-tickers.json";
writeFileSync(
  out,
  JSON.stringify({ source: url, fetchedAt: new Date().toISOString().slice(0, 10), fields: ["ticker", "name", "exchange"], data: rows }) + "\n",
);
console.log(`Wrote ${rows.length} listings to ${out}.`);
