import { z } from 'zod';
import { ResearchDraft } from '../../features/youtube-intelligence/research-brief.ts';

/** Accepted exact-text duplicates are never new coverage. A rejected statement
 * with corrected content may return under a new ID for independent audit. Keep
 * all original statements and excluded additions in the immutable repair trace. */
export function coverageAdditions(original: z.infer<typeof ResearchDraft>, supplement: z.infer<typeof ResearchDraft>, missingIds: string[], rejectedIds: string[] = []) {
  const key = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en');
  const rejected = new Set(rejectedIds);
  const seen = new Set(original.sentences.filter(s=>!rejected.has(s.id)).map(s => key(s.text)));
  const content = (sentence: typeof original.sentences[number]) => JSON.stringify({text:key(sentence.text),evidenceIds:sentence.evidenceIds,externalIds:sentence.externalIds,financialFacts:sentence.financialFacts,calculation:sentence.calculation,kind:sentence.kind,timeMode:sentence.timeMode});
  const unchangedRejected = new Set(original.sentences.filter(s=>rejected.has(s.id)).map(content));
  const missing = new Set(missingIds);
  const retained: typeof supplement.sentences = [];
  const excluded: {sentence: typeof supplement.sentences[number]; reason: string}[] = [];
  for (const sentence of supplement.sentences) {
    const reason = unchangedRejected.has(content(sentence)) ? 'Unchanged rejected content; no corrected evidence or assertion to audit.'
      : seen.has(key(sentence.text)) ? 'Duplicate of an original or earlier supplemental statement.'
      : !sentence.evidenceIds.length || sentence.evidenceIds.some(id => !missing.has(id))
        ? 'Supplement must cite only unresolved evidence IDs.' : null;
    if (reason) excluded.push({sentence, reason});
    else { seen.add(key(sentence.text)); retained.push(sentence); }
  }
  const usedIds = new Set(original.sentences.map(sentence => sentence.id));
  let cursor = 1;
  const sentences = retained.map(sentence => {
    while (usedIds.has(`coverage-${cursor}`)) cursor++;
    const id = `coverage-${cursor++}`;
    usedIds.add(id);
    return { ...sentence, id };
  });
  return { sentences, excluded };
}
