/** Known financial conventions, grounded only in original quote text. These
 * checks do not establish source truth or general semantic completeness. */
const CAGR=String.raw`(?:CAGR(?![a-z])|compound(?:ed)?\s+annual\s+growth(?:\s+rate)?)`;
const number=String.raw`(-?\d+(?:\.\d+)?)`;
const hasCagr=(text:string)=>new RegExp(CAGR,'i').test(text);
const unknownCagr=(text:string)=>/CAGR\s*(?:basis\s*)?(?:is\s*)?(?:unspecified|unknown|not\s+(?:stated|established|specified))|(?:no|unknown|unspecified)\s+CAGR/i.test(text);
const clauses=(text:string)=>text.split(/[;!?]|\.(?!\d)/);
function cagrValues(text:string){return clauses(text).flatMap(text=>[...text.matchAll(new RegExp(CAGR+String.raw`[^%;\n]{0,70}?`+number+String.raw`\s*%`,'gi')),...text.matchAll(new RegExp(number+String.raw`\s*%[^%;\n]{0,70}?`+CAGR,'gi'))].map(m=>Number(m[1])));}
function metrics(text:string){return [
 ['revenue',/\b(?:revenues?|sales)\b/i],['profit',/\b(?:profits?|earnings|EPS)\b/i],['income',/\bincome\b/i],['cash flow',/\bcash[ -]?flows?\b/i],['margin',/\bmargins?\b/i],['users',/\busers?\b/i],
 ] .filter(([,pattern])=>(pattern as RegExp).test(text)).map(([label])=>label as string);}
function compatibleMetric(proposal:string,quote:string){const p=metrics(proposal),q=metrics(quote);return !p.length||!q.length||p.some(m=>q.includes(m));}
const near=(a:number,b:number)=>Math.abs(a-b)<0.011;
function dailyValues(text:string){return text.split(/[;!?]|\.\s+(?=[A-Z])/).flatMap(clause=>{
 if(!/\bdaily\s+(?:yield|return|rate)s?|\b(?:yield|return|rate)s?\s+(?:of\s+)?[^;.!?]{0,30}?\bdaily\b/i.test(clause))return [];
 return [...clause.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)].map(m=>Number(m[1]));
});}
function annualValues(text:string){return [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*%\s*(?:APY|APR|per\s+annum|annually|annual(?:ized)?\s+(?:yield|return|rate))/gi),...text.matchAll(/(?:APY|APR|annual(?:ized)?\s+(?:yield|return|rate))[^%;\n]{0,40}?(-?\d+(?:\.\d+)?)\s*%/gi)].map(m=>Number(m[1]));}
/** Explicit option contract notation establishes only the price role, not
 * ownership, timing or trade execution. Ordinary nearby prices do not. */
function strikeValues(text:string):{value:number;decade:boolean}[] {
 const values:{value:number;decade:boolean}[]=[];
 for(const clause of clauses(text)) {
  if(/\b(?:labor|labour|workers?|union)\s+strikes?\b/i.test(clause))continue;
  if(/\b(?:strike(?:\s+(?:price|level))?|exercise\s+price)\s+(?:(?:is|was|remains)\s+)?(?:unspecified|unknown|unclear|not\s+(?:stated|specified|established))\b/i.test(clause))continue;
  const patterns=[
   /\b(?:strike(?:\s+(?:price|level))?|exercise\s+price)\s*(?:(?:is|was|of|at|around|near|approximately)\s*){0,2}\$?\s*(\d+(?:\.\d+)?)(s)?\b/gi,
   /\$?(\d+(?:\.\d+)?)(s)?[ -]*(?:strike\b|exercise\s+price\b)/gi,
   /\$(\d+(?:\.\d+)?)\s+(?:puts?|calls?)\b/gi,
  ];
  for(const pattern of patterns)for(const match of clause.matchAll(pattern))values.push({value:Number(match[1]),decade:match[2]==='s'});
 }
 return values;
}
const strikeReason='Option strike basis is not established by the cited original quote. A price mentioned while discussing options does not by itself establish an exercise price. Retain the reported price and disclose that the strike is unspecified in an independently audited neutral repair.';
function establishedStrike(value:number,decade:boolean,quotes:string[]){return quotes.flatMap(strikeValues).some(source=>!source.decade&&(decade?source.value>=value&&source.value<value+10:near(source.value,value)));}
export function financialBasisIssue(fact:{label:string;unitDescription?:string|null;value:number;quote:string},originalQuotes:string[]):string|null {
 if(!originalQuotes.some(q=>q.includes(fact.quote)))return null; // anchor guard owns this failure
 if(/\b(?:strike|exercise\s+price)\b/i.test(`${fact.label} ${fact.unitDescription??''}`)&&!establishedStrike(fact.value,false,[fact.quote]))return strikeReason;
 if(hasCagr(`${fact.label} ${fact.unitDescription??''}`)&&!clauses(fact.quote).some(q=>compatibleMetric(fact.label,q)&&cagrValues(q).some(v=>near(v,fact.value))))
  return 'CAGR basis is not established by the exact original quote. A period-growth percentage does not establish annual compounding; original proposed quantity retained for neutral, independently audited repair.';
 if(/\bdaily\s+(?:percentage\s+)?(?:yield|return|rate)/i.test(`${fact.label} ${fact.unitDescription??''}`)&&annualValues(fact.quote).some(v=>near(v,fact.value)))
  return 'Daily return conflicts with the quoted annual percentage basis. Daily crediting is not a daily percentage return; no annual/daily conversion was inferred.';
 return null;
}
export function semanticBasisIssues(text:string,originalQuotes:string[],calculation?:{expression:{kind:string;initial?:number;final?:number;years?:number}}|null):string[]{
 const issues:string[]=[];
 if(strikeValues(text).some(claim=>!establishedStrike(claim.value,claim.decade,originalQuotes)))issues.push(strikeReason);
 for(const cagrText of clauses(text).filter(clause=>hasCagr(clause)&&!unknownCagr(clause))){
  const values=cagrValues(cagrText),explicit=originalQuotes.flatMap(clauses).filter(q=>compatibleMetric(cagrText,q)).flatMap(cagrValues);
  const expression=calculation?.expression;
  const sourceNumbers=originalQuotes.flatMap(q=>[...q.matchAll(/-?\d+(?:,\d{3})*(?:\.\d+)?/g)].map(m=>Number(m[0].replaceAll(',', ''))));
  const duration=expression?.years;
  const durationPattern=String(duration).replaceAll('.', String.raw`\.`);
  const durationAnchored=typeof duration==='number'&&originalQuotes.some(q=>new RegExp(String.raw`(?:^|[^\d.])${durationPattern}\s*(?:-\s*)?(?:years?\b|年)`, 'i').test(q));
  const validCalc=durationAnchored&&expression?.kind==='cagr'&&[expression.initial,expression.final,expression.years].every(v=>typeof v==='number'&&v>0&&sourceNumbers.includes(v));
  const computed=validCalc?100*((expression!.final!/expression!.initial!)**(1/expression!.years!)-1):null;
  const labelledCalculation=/\b(?:calculated|computed|derived)\b/i.test(cagrText);
  if(!values.length||!values.every(v=>explicit.some(e=>near(e,v))||(labelledCalculation&&computed!==null&&Number.isFinite(computed)&&near(computed,v))))
   issues.push('Prose asserts CAGR without an explicit matching original annual-compounding basis or a labelled, audited calculation with retained endpoint/duration values. Keep reported period growth and disclose unspecified basis instead of inventing annualization.');
 }
 const daily=dailyValues(text);
 for(const value of daily){const sourceClauses=originalQuotes.flatMap(clauses);
  const explicitDaily=sourceClauses.some(q=>dailyValues(q).some(v=>near(v,value))&&!annualValues(q).some(v=>near(v,value)));
  if(!explicitDaily&&sourceClauses.some(q=>annualValues(q).some(v=>near(v,value)))){
  issues.push('Prose states a daily percentage yield/return where the corresponding original quantity has an annual/APY basis. Preserve the source rate and frequency uncertainty; daily crediting must not become a daily rate.');break;
 }}
 return issues;
}
