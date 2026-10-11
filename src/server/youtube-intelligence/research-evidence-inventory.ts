import { z } from "zod";
import { Mention, Source, deriveEvidence, type Run } from "../../features/youtube-intelligence/contracts.ts";
import { EvidenceRecord, evidenceInventory } from "../../features/youtube-intelligence/research-brief.ts";

const TranslatedMention = Mention.extend({
  source_span: Mention.shape.source_span.extend({ translation_en: z.string().optional() }),
  source_ranges:z.array(Mention.shape.source_span.extend({translation_en:z.string().optional()})).min(1).optional(),
});
export type ResearchEvidenceOmission = { id: string; reason: string };

/** Preserve accepted company context without converting mentions into trade calls. */
export function researchEvidenceInventoryWithDiagnostics(run: Run) {
  const evidence = evidenceInventory(run);
  const omissions: ResearchEvidenceOmission[] = [];
  const mentions = Array.isArray(run.output.mentions) ? run.output.mentions : [];
  const checks = z.record(z.string(), z.unknown()).safeParse(run.output.mentionChecks ?? {});
  const source = Source.safeParse(run.output.source);
  const ids = new Set(evidence.map(item => item.id));
  for (const [index, raw] of mentions.entries()) {
    const id = `m${index + 1}`;
    const parsed = TranslatedMention.safeParse(raw);
    if (!parsed.success) {
      omissions.push({ id, reason: "Malformed mention or source-span metadata; omitted from research context." });
      continue;
    }
    const mention = parsed.data;
    if (mention.is_call) continue;
    const key = `${mention.ticker ?? mention.instrument_as_spoken}:${mention.source_span.start_id}:${mention.source_span.end_id}`;
    if (!checks.success || checks.data[key] !== true) continue;
    try {
      if (!source.success) throw Error("Retained transcript is missing or malformed.");
      if (ids.has(id)) throw Error("Evidence ID collides with an existing accepted item.");
      const spans=mention.source_ranges ?? [mention.source_span];
      const primary=mention.source_span;
      if(['start_id','end_id','start_seconds','end_seconds','text_hash'].some(key=>spans[0][key as keyof typeof primary]!==primary[key as keyof typeof primary]))
        throw Error('First retained mention range no longer matches its original jump pointer.');
      const seen=new Set<string>();
      const quotes=spans.flatMap((span,index)=>{
        const original=deriveEvidence(source.data,span);
        if(original.text_hash!==span.text_hash)throw Error('Retained mention span does not match its original text hash.');
        if(original.start_seconds!==span.start_seconds||original.end_seconds!==span.end_seconds)
          throw Error('Retained mention timestamps no longer match the source span.');
        const key=`${span.start_id}:${span.end_id}:${span.text_hash}`;
        if(seen.has(key))return [];
        seen.add(key);
        return [{startId:span.start_id,endId:span.end_id,text:original.quote_original,
          translation:span.translation_en ?? (index===0?primary.translation_en:'') ?? '',
          start:original.start_seconds,end:original.end_seconds,hash:original.text_hash}];
      });
      evidence.push(EvidenceRecord.parse({
        id, kind: "research_context", summary: `Creator commentary: ${mention.rationale_en}`,
        instrument: mention.instrument_as_spoken, ticker: mention.ticker, stance: mention.stance,
        horizon: null, conditions: [], risks: [], levels: [], trust: "L1",
        quotes,
      }));
      ids.add(id);
    } catch (error) {
      omissions.push({ id, reason: error instanceof Error ? error.message : "Mention evidence could not be reconstructed." });
    }
  }
  return { evidence, omissions };
}

export function researchEvidenceInventory(run: Run) {
  return researchEvidenceInventoryWithDiagnostics(run).evidence;
}
