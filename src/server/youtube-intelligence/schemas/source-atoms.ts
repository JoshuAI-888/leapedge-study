import {z} from 'zod';
import {SourceAtom} from '../../../features/youtube-intelligence/source-atoms.ts';
/** Retain the native schema dialect used by pointer extraction. A nested
 * $schema would not switch the SDK to responseJsonSchema. */
function nativeSchema(raw:unknown):any{
 if(Array.isArray(raw))return raw.map(nativeSchema);
 if(!raw||typeof raw!=='object')return raw;
 const value=raw as Record<string,any>;
 if(value.anyOf?.length===2&&value.anyOf.some((s:any)=>s.type==='null'))return {...nativeSchema(value.anyOf.find((s:any)=>s.type!=='null')),nullable:true};
 return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='$schema').map(([k,v])=>[k,nativeSchema(v)]));
}
export function atomExtractionSchema<T extends {properties:{key_points:{items:unknown}}}>(base:T){
 const schema=structuredClone(base),item=schema.properties.key_points.items as {properties:Record<string,unknown>;required:string[]};
 item.properties.source_atom=nativeSchema(z.toJSONSchema(SourceAtom));item.required=[...item.required,'source_atom'];
 return schema;
}
