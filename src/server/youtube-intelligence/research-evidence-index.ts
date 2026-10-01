import { createHash } from "node:crypto";
import { z } from "zod";
import {
  EvidenceRecord,
  type EvidenceRecordData,
} from "../../features/youtube-intelligence/research-brief.ts";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const IndexedRecord = EvidenceRecord.omit({ quotes: true }).extend({
  quoteIds: z.array(z.string()),
});
const Body = z.object({
  version: z.literal("research-evidence-index.v1"),
  inventory: z.array(IndexedRecord),
  quotes: z.array(
    z.object({ id: z.string(), quote: EvidenceRecord.shape.quotes.element }),
  ),
});
export const EvidenceIndex = Body.extend({ hash: z.string() });

/** Lossless dictionary encoding: repeated spans share a key, never a summary.
 * Timestamp, translation and original hash are part of the key. */
export function buildEvidenceIndex(input: EvidenceRecordData[]) {
  const evidence = z.array(EvidenceRecord).parse(input);
  if (new Set(evidence.map((e) => e.id)).size !== evidence.length)
    throw Error("Duplicate evidence IDs.");
  const quotes = new Map<string, z.infer<typeof Body>["quotes"][number]>();
  const inventory = evidence.map(({ quotes: spans, ...item }) => ({
    ...item,
    quoteIds: spans.map((quote) => {
      const id = "q" + digest(quote).slice(0, 24);
      const previous = quotes.get(id);
      if (previous && JSON.stringify(previous.quote) !== JSON.stringify(quote))
        throw Error("Quote digest collision.");
      quotes.set(id, { id, quote });
      return id;
    }),
  }));
  const body = Body.parse({
    version: "research-evidence-index.v1",
    inventory,
    quotes: [...quotes.values()],
  });
  return EvidenceIndex.parse({ ...body, hash: digest(body) });
}

export function expandEvidenceIndex(raw: unknown): EvidenceRecordData[] {
  const { hash, ...body } = EvidenceIndex.parse(raw);
  if (hash !== digest(body)) throw Error("Evidence index integrity mismatch.");
  const quotes = new Map(body.quotes.map((q) => [q.id, q.quote]));
  return body.inventory.map(({ quoteIds, ...item }) =>
    EvidenceRecord.parse({
      ...item,
      quotes: quoteIds.map((id) => {
        const quote = quotes.get(id);
        if (!quote) throw Error("Missing indexed quote.");
        return quote;
      }),
    }),
  );
}

export const INDEX_INSTRUCTIONS =
  " Evidence is a lossless dictionary: evidenceIndex.inventory holds every accepted call and context item with its original evidence id; quoteIds resolve into evidenceIndex.quotes. Read the exact original quotation and translation there. Cite inventory evidence ids, never quote dictionary ids. Inspect ALL inventory items for company/topic coverage, including uncited countercases and qualifications. Dictionary compression does not change evidence status.";
