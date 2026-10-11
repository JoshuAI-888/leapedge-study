import {z} from 'zod';
import {SourceAtom} from '../../../features/youtube-intelligence/source-atoms.ts';
/** Retain the native schema dialect used by pointer extraction. A nested
 * $schema would not switch the SDK to responseJsonSchema. The native Schema
 * protobuf uses enum for literals and has no additionalProperties field;
 * the full local Zod contract remains authoritative after generation. */
function nativeSchema(raw:unknown):any{
 if(Array.isArray(raw))return raw.map(nativeSchema);
 if(!raw||typeof raw!=='object')return raw;
 const value=raw as Record<string,any>;
 if(value.anyOf?.length===2&&value.anyOf.some((s:any)=>s.type==='null'))return {...nativeSchema(value.anyOf.find((s:any)=>s.type!=='null')),nullable:true};
 const result=Object.fromEntries(Object.entries(value).filter(([k])=>!['$schema','const','additionalProperties'].includes(k)).map(([k,v])=>[k,nativeSchema(v)]));
 if(Object.hasOwn(value,'const'))result.enum=[value.const];
 return result;
}
export function atomExtractionSchema<T extends {properties:{key_points:{items:unknown}}}>(base:T){
 const schema=structuredClone(base),item=schema.properties.key_points.items as {properties:Record<string,unknown>;required:string[]};
 item.properties.source_atom=nativeSchema(z.toJSONSchema(SourceAtom));item.required=[...item.required,'source_atom'];
 return schema;
}
