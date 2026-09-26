/** Deliberately narrow: only explicit new-for-old and old-to-new share counts.
 * Bare “1:3”, mixed company ratios and inferred corporate actions are unresolved. */
type Ratio = { newShares: number; oldShares: number };
const words: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const token = String.raw`(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)`;
const value = (raw: string) => words[raw.toLowerCase()] ?? Number(raw);
const same = (left: Ratio, right: Ratio) =>
  left.newShares * right.oldShares === right.newShares * left.oldShares;
function explicitRatios(text: string): Ratio[] {
  const found: Ratio[] = [];
  const add = (newShares: number, oldShares: number) => {
    if (Number.isSafeInteger(newShares) && Number.isSafeInteger(oldShares) &&
        newShares > 0 && oldShares > 0 && newShares <= 1000000 && oldShares <= 1000000 &&
        !found.some(item => same(item, { newShares, oldShares })))
      found.push({ newShares, oldShares });
  };
  for (const match of text.matchAll(new RegExp(String.raw`\b(${token})[\s-]+for[\s-]+(${token})\s+(?:reverse\s+)?(?:(?:stock|share)\s+)?split\b`, 'gi')))
    add(value(match[1]), value(match[2]));
  for (const match of text.matchAll(new RegExp(String.raw`\b(?:reverse\s+)?(?:stock|share)\s+split\s+(?:of\s+|at\s+|ratio\s+of\s+)?(${token})[\s-]+for[\s-]+(${token})\b`, 'gi')))
    add(value(match[1]), value(match[2]));
  for (const match of text.matchAll(/(\d+)\s*股\s*(?:拆(?:分)?(?:为|為|成)?|分拆(?:为|為|成)?)\s*(\d+)\s*股/g))
    add(Number(match[2]), Number(match[1]));
  for (const match of text.matchAll(new RegExp(String.raw`\b(?:each\s+|every\s+)?(${token})\s+(?:(?:existing|old)\s+)?shares?\s+(?:will\s+be\s+|is\s+|are\s+)?(?:split\s+into|converted\s+into|becomes?)\s+(${token})\s+(?:new\s+)?shares?\b`, 'gi')))
    add(value(match[2]), value(match[1]));
  for (const match of text.matchAll(new RegExp(String.raw`\b(?:each|every)\s+(?:existing\s+|old\s+)?share\s+(?:will\s+be\s+|is\s+)?(?:split\s+into|converted\s+into|becomes)\s+(${token})\s+(?:new\s+)?shares?\b`, 'gi')))
    add(value(match[1]), 1);
  return found;
}
export function stockSplitDirectionCheck(text: string, originalQuotes: string[]) {
  const proposed = explicitRatios(text);
  if (!proposed.length) return { conflict: false, unresolved: false };
  // Inspect the original language, never an existing generated translation.
  const source = explicitRatios(originalQuotes.join('\n'));
  if (proposed.length !== 1 || source.length !== 1)
    return { conflict: false, unresolved: true };
  return { conflict: !same(proposed[0], source[0]), unresolved: false };
}

/** Match the exact stated quantity, not another metric elsewhere in its quote. */
export function explicitPercentagePointConflict(amount: number, quote: string) {
  const points = [...quote.matchAll(/(\d+(?:\.\d+)?)\s*(?:个|個)?(?:百分点|百分點|percentage[ -]points?)/gi)]
    .map(match => Number(match[1]));
  const percentages = [
    ...[...quote.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|％|percent\b(?!age))/gi)].map(match => Number(match[1])),
    ...[...quote.matchAll(/百分之\s*(\d+(?:\.\d+)?)/g)].map(match => Number(match[1])),
  ];
  return points.includes(amount) && !percentages.includes(amount);
}
