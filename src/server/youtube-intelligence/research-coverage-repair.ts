import { z } from 'zod';
import { ResearchDraft } from '../../features/youtube-intelligence/research-brief.ts';

/** Exact-text duplicates are never new coverage. Keep rejected additions in the
 * repair trace; do not delete or rewrite any original statement or source. */
export function coverageAdditions(original: z.infer<typeof ResearchDraft>, supplement: z.infer<typeof ResearchDraft>, missingIds: string[]) {
  const key = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en');
  const seen = new Set(original.sentences.map(s => key(s.text)));
  const missing = new Set(missingIds);
  const retained: typeof supplement.sentences = [];
  const excluded: {sentence: typeof supplement.sentences[number]; reason: string}[] = [];
  for (const sentence of supplement.sentences) {
    const reason = seen.has(key(sentence.text)) ? 'Duplicate of an original or earlier supplemental statement.'
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
