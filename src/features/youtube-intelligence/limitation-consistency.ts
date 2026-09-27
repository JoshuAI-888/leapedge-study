// Derived source consistency only. Original notes and their provenance are preserved.
import {stockSplitDirectionCheck} from './source-quantity-checks.ts';
type Evidence = {id:string;instrument?:string|null;ticker?:string|null;quotes:{text:string}[]};
type Brief = {evidence:Evidence[];omissions:string[]};
const hasRatio = (text:string) => stockSplitDirectionCheck(text, []).unresolved;
const aliases = (e:Evidence) => [e.instrument, e.ticker, ...[...(e.instrument ?? '').matchAll(/[（(]([^）)]+)[）)]/g)].map(m => m[1])].filter((x):x is string=>!!x);
const mentions = (text:string, alias:string) => {
 const escaped=alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`,'iu').test(text);
};
export function inspectLimitations(brief:Brief) {
 const splitEvidence=brief.evidence.filter(e=>e.quotes.some(q=>hasRatio(q.text)));
 const companies=new Set(splitEvidence.map(e=>e.ticker || e.instrument || `unidentified:${e.id}`));
 return brief.omissions.map((original,index)=>{
  if(!hasRatio(original))return {index,original,status:'not_checked',evidenceIds:[]};
  const matched=splitEvidence.filter(e=>aliases(e).some(a=>mentions(original,a)));
  const uniqueCompany=companies.size===1 && matched.length>0;
  const quotes=matched.flatMap(e=>e.quotes.map(q=>q.text));
  const result=uniqueCompany?stockSplitDirectionCheck(original,quotes):{conflict:false,unresolved:true};
  if(result.conflict)return {index,original,status:'source_conflict',evidenceIds:matched.map(e=>e.id),warning:'Original limitation contains a stock-split direction that conflicts with its explicitly identified source passage. Treat the ratio in this note as unreliable. The original note is retained; this check does not establish external corroboration.',quotes};
  if(result.unresolved)return {index,original,status:'unresolved',evidenceIds:matched.map(e=>e.id),warning:'Stock-split direction in this original limitation could not be assigned unambiguously to one company and one explicit source ratio. No correction inferred.'};
  return {index,original,status:'direction_consistent',evidenceIds:matched.map(e=>e.id)};
 });
}
