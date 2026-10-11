import type {FinancialFactData} from './research-brief.ts';
const scales:Record<string,number>={ones:1,thousands:1e3,millions:1e6,billions:1e9,trillions:1e12,thousand:1e3,million:1e6,billion:1e9,trillion:1e12,'万亿':1e12,'萬億':1e12,'万億':1e12,'萬亿':1e12,'万':1e4,'萬':1e4,'亿':1e8,'億':1e8};
/** Structural literal check only. Never repairs decimal points or currencies. */
export function sourceNumericCheck(fact:FinancialFactData,retainedQuotes:string[]) {
 const result=(status:'literal_supported'|'unresolved'|'not_assessed',reason:string)=>({status,reason,original:fact});
 if(!fact.quote?.trim()||!retainedQuotes.some(q=>q.includes(fact.quote)))return result('unresolved','Exact original quote is not anchored.');
 // Only explicit denomination/range grammar permits these conversions. An
 // unpunctuated caption integer is never a decimal reconstruction candidate.
 const close=(n:number)=>Math.abs(n-fact.value*scales[fact.scale])<=Math.max(1e-8,Math.abs(n)*1e-12);
 const cents=[...fact.quote.matchAll(/\b(\d+(?:\.\d+)?)\s+cents?\b/gi)];
 if(cents.some(m=>close(Number(m[1])/100)) && fact.scale==='ones' &&
    (fact.unit==='total'||fact.unit==='per_share'&&/\b(?:EPS|per[ -]share|earnings per share)\b/i.test(fact.quote)))
  return result('not_assessed','Explicit cents permit division by 100, not caption decimal reconstruction. Currency, metric association, period and basis still require independent audit.');
 const ranges=[...fact.quote.matchAll(/(?:\bbetween\s+)?(?:(?:USD|US\$|\$|EUR|€|GBP|£)\s*)?(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:and|to|[–—-])\s*(?:(?:USD|US\$|\$|EUR|€|GBP|£)\s*)?(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*(thousand|million|billion|trillion)\b/gi)];
 const sharedScaleMatch=ranges.some(m=>[m[1],m[2]].some(n=>close(Number(n.replaceAll(',',''))*scales[m[3].toLowerCase()])));
 if(sharedScaleMatch && !['percent','percentage_points','basis_points','shares','contracts'].includes(fact.unit)) {
  const explicitCurrency=/\bUSD\b|US\$/.test(fact.quote)?'USD':/\bEUR\b|€/.test(fact.quote)?'EUR':/\bGBP\b|£/.test(fact.quote)?'GBP':null;
  if(explicitCurrency && fact.currency!==explicitCurrency)return result('unresolved','Explicit range currency mismatches proposed currency.');
  return result('not_assessed','Explicit two-endpoint range shares its trailing scale; no scale is borrowed from a neighboring count. Currency, endpoint association and metric semantics still require independent audit.');
 }
 // A narrowly recognized word amount can prevent a false Arabic-token mismatch.
 // It does not prove the metric, attribution, qualifier or annual/daily basis.
 const halfWords:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
 const halves=[...fact.quote.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten)[ -]+and[ -]+a[ -]+half\s*(thousand|million|billion|trillion)?\s*(%|percent\b|dollars?\b|shares?\b)?/gi)];
 const matchingHalf=halves.some(m=>{
  const suffix=m[3]?.toLowerCase();
  const tail=fact.quote.slice((m.index??0)+m[0].length);
  if(/^\s*(?:years?|months?|days?|hours?|minutes?|seconds?)\b/i.test(tail))return false;
  const rate=suffix==='%'||suffix==='percent';
  if(rate ? fact.unit!=='percent'||fact.currency!==null||fact.scale!=='ones' : !m[2]||['percent','percentage_points','basis_points'].includes(fact.unit))return false;
  const magnitude=(halfWords[m[1].toLowerCase()]+0.5)*(scales[m[2]?.toLowerCase()??'ones']??1);
  return Math.abs(magnitude-fact.value*scales[fact.scale])<=Math.max(1e-8,Math.abs(magnitude)*1e-12);
 });
 if(matchingHalf)return result('not_assessed','A recognized English N-and-a-half amount matches the proposed magnitude and scale, so Arabic tokens alone cannot disprove it. Metric, frequency and source fidelity remain independently unassessed; no decimal was guessed or literal verification awarded.');
 const tokens=[...fact.quote.matchAll(/(?:(USD|US\$|\$|EUR|€|GBP|£)\s*)?(-?\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*(thousand|million|billion|trillion|万亿|萬億|万億|萬亿|万|萬|亿|億))?(?:\s*(basis[ -]points?|bps?|percentage[ -]points?|percent|[%％]))?/gi)];
 if(!tokens.length)return result('not_assessed','No Arabic numeric literal parsed; semantic/numeric fidelity still requires audit, not automatic rejection.');
 const proposedMagnitude=fact.value*scales[fact.scale];
 const amounts=tokens.map(t=>{
  const amount=Number(t[2].replaceAll(',',''))*(scales[t[3]?.toLowerCase()??'ones']??1);
  if(/basis|^bps?$/i.test(t[4]??'')&&fact.unit==='percentage_points'&&fact.currency===null&&fact.scale==='ones')return amount/100;
  if(/percentage/i.test(t[4]??'')&&fact.unit==='basis_points'&&fact.currency===null&&fact.scale==='ones')return amount*100;
  return amount;
 });
 if(tokens.length>1){
  if(!amounts.some(n=>Math.abs(n-proposedMagnitude)<=Math.max(1e-8,Math.abs(n)*1e-12)))return result('unresolved','Proposed normalized number is absent from every original literal in this exact quote; possible transcription/decimal reconstruction, not established source value.');
  return result('not_assessed','A numeric match exists among multiple quantities, but metric association is not deterministically assessed. Preserve useful content pending independent audit.');
 }
 const m=tokens[0],value=Number(m[2].replaceAll(',',''))*(scales[m[3]?.toLowerCase()??'ones']??1),proposed=fact.value*scales[fact.scale];
 const rate=m[4]?.toLowerCase();
 if(rate){
  const unit=/basis|^bps?$/.test(rate)?'basis_points':/percentage/.test(rate)?'percentage_points':'percent';
  if(fact.currency!==null||fact.scale!=='ones'||m[3])return result('unresolved','Rate currency or scale is not supported by the literal.');
  const equivalent=unit===fact.unit?Math.abs(value-proposed)<1e-10:unit==='basis_points'&&fact.unit==='percentage_points'?Math.abs(value/100-proposed)<1e-10:unit==='percentage_points'&&fact.unit==='basis_points'?Math.abs(value*100-proposed)<1e-10:false;
  return equivalent?result('literal_supported','Exact rate literal or basis-point/percentage-point conversion matches; metric semantics still require audit.'):result('unresolved','Proposed numeric value/unit is not supported by the original rate literal; no decimal or unit inferred.');
 }
 if(!m[1])return Math.abs(value-proposed)>Math.max(1e-8,Math.abs(value)*1e-12)?result('unresolved','Proposed number differs from the exact original literal; dimension and decimal cannot be inferred.'):result('not_assessed','Numeric token matches but original dimension is unspecified; do not infer percentage or currency or award support.');
 const currency=/^(USD|US\$)$/i.test(m[1])?'USD':m[1]==='€'||m[1]==='EUR'?'EUR':m[1]==='GBP'||m[1]==='£'?'GBP':null;
 if(currency===null)return Math.abs(value-proposed)>Math.max(1e-8,Math.abs(value)*1e-12)?result('unresolved','Proposed number differs from original dollar-denominated literal; no decimal repair inferred.'):result('not_assessed','Amount matches but dollar currency is not independently established; this alone does not reject the useful claim.');
 if(fact.currency!==currency)return result('unresolved','Explicit source currency mismatches proposed currency.');
 if(!['total','per_share'].includes(fact.unit)||fact.unit==='per_share'&&!/\b(?:EPS|per[ -]share|earnings per share)\b/i.test(fact.quote))return result('not_assessed','Metric denominator is not established by the original quote; no automatic numerical rejection or support.');
 return Math.abs(value-proposed)<=Math.max(1e-8,Math.abs(value)*1e-12)?result('literal_supported','Literal amount/scale and currency match; period, basis and semantic association still require audit.'):result('unresolved','Proposed value/scale does not match original literal. Possible caption ambiguity; neither number is asserted correct.');
}
export function numericalSentenceDisposition(sentence:{text:string;financialFacts:FinancialFactData[];evidenceIds:string[]},evidence:{id:string;quotes:{text:string}[]}[]) {
 const checks=sentence.financialFacts.map(f=>sourceNumericCheck(f,evidence.filter(e=>e.id===f.evidenceId&&sentence.evidenceIds.includes(e.id)).flatMap(e=>e.quotes.map(q=>q.text))));
 const hasNumber=(n:number)=>[...sentence.text.matchAll(/-?\d+(?:,\d{3})*(?:\.\d+)?/g)].some(m=>Number(m[0].replaceAll(',',''))===n);
 const unsafe=checks.some(c=>c.status==='unresolved'&&hasNumber(c.original.value));
 return {status:unsafe?'neutral_repair_required' as const:'retain_with_checks' as const,checks,reason:unsafe?'Retain original draft and audit; withhold unsupported numerical prose pending independently audited neutral/qualified repair.':'No repeated unresolved typed number detected. This is not semantic or numerical completeness certification.'};
}

/** Missing typed metadata is not a way around literal decimal safeguards.
 * This deliberately covers only directly asserted EPS/inflation decimals;
 * computed results and unrelated quantities still require semantic audit. */
export function sourceQuantityProseIssues(sentence:{text:string;calculation?:unknown},quotes:string[]) {
 const candidates=[...sentence.text.matchAll(/\b(?:EPS|earnings per share|CPI|PCE|inflation)\b[^.!?;\d]{0,40}(\d+\.\d+)/gi)].map(m=>Number(m[1]));
 const literals=quotes.flatMap(q=>[...q.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)].map(m=>Number(m[0].replaceAll(',',''))));
 const cents=quotes.flatMap(q=>[...q.matchAll(/\b(\d+(?:\.\d+)?)\s+cents?\b/gi)].map(m=>Number(m[1])/100));
 const reconstructed=candidates.filter(value=>![...literals,...cents].some(n=>Math.abs(n-value)<1e-8)&&literals.some(n=>Number.isInteger(n)&&n>=10&&[10,100,1000].some(scale=>Math.abs(n-value*scale)<1e-8)));
 const issues=reconstructed.length ? ['Direct numerical prose reconstructs an EPS or inflation decimal absent from the original literals. Retain caption ambiguity; a missing typed financial fact cannot establish the decimal.'] : [];
 // A count can be an ambiguous caption integer as well as a decimal. Only
 // direct stated customer/client/deal counts are checked here; a supplied
 // calculation remains a distinct proposition, never a source quote.
 const countClaims=[...sentence.text.matchAll(/\b(\d+(?:,\d{3})*)\s+(customers?|clients?|deals?)\b/gi)];
 for(const claim of countClaims) {
  const noun=claim[2].toLowerCase().replace(/s$/,'');
  const hasOriginalCount=quotes.some(q=>new RegExp(`\\b${noun}s?\\b`,'i').test(q)&&/\d/.test(q));
  const value=Number(claim[1].replaceAll(',',''));
  if(hasOriginalCount&&!literals.includes(value))issues.push('Direct customer/client/deal count is absent from the retained original literals. Do not reconstruct a plausible count from growth rates or neighboring figures; preserve the ambiguity and independently review a narrower clause.');
 }
 return issues;
}
