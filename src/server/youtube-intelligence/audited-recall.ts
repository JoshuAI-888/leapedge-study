import type {SourceData} from '../../features/youtube-intelligence/contracts.ts';
import {sourceRecallPlan} from '../../features/youtube-intelligence/source-recall.ts';
import {AdmissionStoppedError,isFatalAccountError} from './bounded-parallel.ts';
/** Every original cue survives; only request packing changes. */
export const packedRecallPlan=(source:SourceData)=>sourceRecallPlan(source,{cues:60,bytes:18000,seconds:240});
/** Keep the complete candidate when any original cited cue intersects this
 * review window. Nonlocal candidates cannot prove this window's coverage. */
export function localRecallInventory<T extends {evidence?:{segment_id:string;end_segment_id?:string|null}[]}>(inventory:readonly T[],window:SourceData['segments'],source:SourceData):T[]{
 const ids=new Set(window.map(c=>c.id));const position=new Map(source.segments.map((c,i)=>[c.id,i]));
 return inventory.filter(candidate=>candidate.evidence?.some(e=>{
  const first=position.get(e.segment_id),last=position.get(e.end_segment_id??e.segment_id);
  if(first===undefined||last===undefined||last<first)return true; // retain uncertainty, never truncate
  return source.segments.slice(first,last+1).some(c=>ids.has(c.id));
 }));
}
/** One local admission limit across discovery and critique. Provider-wide
 * database admission remains a second independent bound. */
export function sharedAdmission(limit:number){
 if(!Number.isInteger(limit)||limit<1||limit>16)throw Error('Invalid shared admission bound.');
 let active=0;let stopped:unknown=null;const waiting:(()=>void)[]=[];
 return async function admit<T>(action:()=>Promise<T>):Promise<T>{
  if(active>=limit)await new Promise<void>(resolve=>waiting.push(resolve));else active++;
  if(stopped!==null)throw new AdmissionStoppedError(stopped);
  try{return await action();}catch(error){if(isFatalAccountError(error))stopped=error;throw error;}
  finally{if(stopped!==null){active--;while(waiting.length)waiting.shift()!();}else{const next=waiting.shift();if(next)next();else active--;}}
 };
}
