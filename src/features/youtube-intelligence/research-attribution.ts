/** A turn marker demonstrates a speaker boundary, never a speaker identity.
 * This narrow guard is not diarization and cannot certify unmarked speakers. */
export function mixedTurnAttribution(sentence:{text:string;speaker:string;evidenceIds:string[]},evidence:{id:string;quotes:{text:string}[]}[]) {
 const mixed=evidence.filter(e=>sentence.evidenceIds.includes(e.id)).some(e=>e.quotes.some(q=>q.text.includes('>>')));
 const role=/\b(?:guests?|hosts?|creators?|commentators?|interviewers?|interviewees?)\b|嘉宾|嘉賓|主持人|博主|创作者|創作者/i.test(sentence.text);
 const named=!!sentence.speaker.trim() && sentence.speaker.toLowerCase()!=='unknown';
 return {requiresNeutralRepair:mixed && (role||named), reason:'Cited original passages contain speaker-turn boundaries without reviewed identity mapping. Preserve distinct proposals and conditions in neutral discussion wording with speaker unknown; independently audit the new candidate. Original role-specific draft remains retained.'};
}

/** Narrow source-only promotion checks, not a replacement for independent
 * semantic review. Quotes remain separate; no identity or unseen instruction
 * is inferred from an uploader, stance field, or generated summary. */
function hasAdvice(text:string) {
 const matches=[...text.matchAll(/\b(?:advises?|recommends?|urges?)\b[^.!?;]{0,80}\b(?:avoid(?:ing)?|buy(?:ing)?|sell(?:ing)?|invest(?:ing)?|wait(?:ing)?)\b|\b(?:investors?|viewers?|you)\s+should\s+(?:avoid|buy|sell|wait)\b/gi)];
 return matches.some(m=>!/(?:\bnot|\bnever|n't)\s+(?:(?:currently|personally|explicitly)\s+)?$/i.test(text.slice(0,m.index)));
}
export function sourceAttributionCheck(sentence:{text:string;speaker:string;evidenceIds:string[]},evidence:{id:string;quotes:{text:string}[]}[]) {
 const quotes=evidence.filter(e=>sentence.evidenceIds.includes(e.id)).flatMap(e=>e.quotes.map(q=>q.text));
 const reasons:string[]=[];
 const turns=mixedTurnAttribution(sentence,evidence);
 if(turns.requiresNeutralRepair)reasons.push(turns.reason);
 const personal=quotes.some(q=>/\b(?:for me|does not interest me|doesn't interest me|I (?:do not|don't) want to buy|I (?:would not|wouldn't) buy)\b/i.test(q));
 const advice=hasAdvice(sentence.text);
 const sourceAdvice=quotes.some(hasAdvice);
 if(personal&&advice&&!sourceAdvice)reasons.push('A personal investment preference was promoted into advice to investors. Preserve the source actor and personal stance; independently audit a narrower candidate.');
 const capitalCondition=/\bbefore\s+(?:committing|deploying|investing)\s+(?:capital|money)|\bbefore\s+(?:buying|entering|taking)\s+(?:a\s+)?(?:position|shares|the stock)\b/i;
 if(capitalCondition.test(sentence.text)&&!quotes.some(q=>capitalCondition.test(q)))
  reasons.push('The before-entry or committing-capital condition is absent from the cited source. Monitoring alone does not establish an investment instruction.');
 const statedNumbers=[...sentence.text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)].map(m=>Number(m[0].replaceAll(',','')));
 const conditionalQuote=quotes.some(q=>[...q.matchAll(/\b(?:if|assuming|suppose)\b(?:[^.!?;]|\.(?=\d)){0,180}/gi)].some(m=>[...m[0].matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)].some(n=>statedNumbers.includes(Number(n[0].replaceAll(',',''))))));
 const unqualifiedForecast=/\b(?:will (?:reach|rise|grow|earn|trade)|is forecast to|expects? (?:EPS|earnings|a price))\b/i.test(sentence.text)&&!/\b(?:if|assuming|suppose|scenario|could|would|conditional)\b/i.test(sentence.text);
 if(conditionalQuote&&unqualifiedForecast)reasons.push('A conditional numerical scenario was promoted to an unqualified forecast. Preserve the original condition and independently audit the new candidate.');
 return {requiresNeutralRepair:reasons.length>0,reason:reasons.join(' '),reasons};
}
