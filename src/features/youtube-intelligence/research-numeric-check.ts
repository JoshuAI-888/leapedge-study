import type {FinancialFactData} from './research-brief.ts';
const scales:Record<string,number>={ones:1,thousands:1e3,millions:1e6,billions:1e9,trillions:1e12,thousand:1e3,million:1e6,billion:1e9,trillion:1e12,'万亿':1e12,'萬億':1e12,'万億':1e12,'萬亿':1e12,'万':1e4,'萬':1e4,'亿':1e8,'億':1e8};
/** Structural literal check only. Never repairs decimal points or currencies. */
export function sourceNumericCheck(fact:FinancialFactData,retainedQuotes:string[]) {
 const result=(status:'literal_supported'|'unresolved'|'not_assessed',reason:string)=>({status,reason,original:fact});
 if(!fact.quote?.trim()||!retainedQuotes.some(q=>q.includes(fact.quote)))return result('unresolved','Exact original quote is not anchored.');
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
