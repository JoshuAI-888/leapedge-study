/** A turn marker demonstrates a speaker boundary, never a speaker identity.
 * This narrow guard is not diarization and cannot certify unmarked speakers. */
export function mixedTurnAttribution(sentence:{text:string;speaker:string;evidenceIds:string[]},evidence:{id:string;quotes:{text:string}[]}[]) {
 const mixed=evidence.filter(e=>sentence.evidenceIds.includes(e.id)).some(e=>e.quotes.some(q=>q.text.includes('>>')));
 const role=/\b(?:guests?|hosts?|creators?|commentators?|interviewers?|interviewees?)\b|嘉宾|嘉賓|主持人|博主|创作者|創作者/i.test(sentence.text);
 const named=!!sentence.speaker.trim() && sentence.speaker.toLowerCase()!=='unknown';
 return {requiresNeutralRepair:mixed && (role||named), reason:'Cited original passages contain speaker-turn boundaries without reviewed identity mapping. Preserve distinct proposals and conditions in neutral discussion wording with speaker unknown; independently audit the new candidate. Original role-specific draft remains retained.'};
}
