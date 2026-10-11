import {buildEvidenceIndex,expandEvidenceIndex,INDEX_INSTRUCTIONS} from './research-evidence-index.ts';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {EvidenceRecord,type EvidenceRecordData} from '../../features/youtube-intelligence/research-brief.ts';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const AtomBody=EvidenceRecord.omit({id:true,quotes:true});
const Body=z.object({version:z.literal('research-atom-index.v1'),atoms:z.array(z.object({id:z.string(),body:AtomBody})),inventory:z.array(z.object({id:z.string(),atomId:z.string(),quoteIds:z.array(z.string())})),quotes:z.array(z.object({id:z.string(),quote:EvidenceRecord.shape.quotes.element}))});
export const AtomEvidenceIndex=Body.extend({hash:z.string()});
/** Exact accepted bodies only. No synonym/speaker/period/condition inference.
 * All original evidence IDs and quotation metadata survive expansion. */
export function buildAtomEvidenceIndex(raw:EvidenceRecordData[]){
 const evidence=z.array(EvidenceRecord).parse(raw);
 if(new Set(evidence.map(e=>e.id)).size!==evidence.length)throw Error('Duplicate evidence IDs.');
 const atoms=new Map<string,z.infer<typeof Body>['atoms'][number]>(),quotes=new Map<string,z.infer<typeof Body>['quotes'][number]>();
 const inventory=evidence.map(({id,quotes:spans,...body})=>{
  const atomId='a'+digest(body.source_atom?body:{id,body}).slice(0,24);
  const existing=atoms.get(atomId);if(existing&&JSON.stringify(existing.body)!==JSON.stringify(body))throw Error('Atom digest collision.');
  atoms.set(atomId,{id:atomId,body});
  const quoteIds=spans.map(quote=>{
   const qid='q'+digest(quote).slice(0,24),previous=quotes.get(qid);
   if(previous&&JSON.stringify(previous.quote)!==JSON.stringify(quote))throw Error('Quote digest collision.');
   quotes.set(qid,{id:qid,quote});return qid;
  });
  return {id,atomId,quoteIds};
 });
 const body=Body.parse({version:'research-atom-index.v1',atoms:[...atoms.values()],inventory,quotes:[...quotes.values()]});
 return AtomEvidenceIndex.parse({...body,hash:digest(body)});
}
export function expandAtomEvidenceIndex(raw:unknown):EvidenceRecordData[]{
 const {hash,...body}=AtomEvidenceIndex.parse(raw);if(hash!==digest(body))throw Error('Atom evidence index integrity mismatch.');
 const atoms=new Map(body.atoms.map(a=>[a.id,a.body])),quotes=new Map(body.quotes.map(q=>[q.id,q.quote]));
 if(atoms.size!==body.atoms.length||quotes.size!==body.quotes.length||new Set(body.inventory.map(e=>e.id)).size!==body.inventory.length)throw Error('Duplicate dictionary identities.');
 return body.inventory.map(({id,atomId,quoteIds})=>{
  const atom=atoms.get(atomId);if(!atom)throw Error('Missing indexed atom.');
  return EvidenceRecord.parse({id,...atom,quotes:quoteIds.map(qid=>{const q=quotes.get(qid);if(!q)throw Error('Missing indexed quote.');return q;})});
 });
}
export const ATOM_INDEX_INSTRUCTIONS=' atomEvidenceIndex is a lossless dictionary of independently accepted extraction proposals: inventory holds every original evidence id, atomId and quoteIds; atoms holds the exact common proposition metadata; quotes holds each complete original quotation and translation. Resolve both dictionaries before reasoning. Cite inventory evidence ids, never atomId or quoteIds. Identical bodies sharing an atom are repetition, not independent corroboration; separate original IDs and ranges retain their own provenance. Inspect every original item for coverage, including conditions/opposing clauses. Atomic metadata is not verified financial truth.';
export function atomSynthesisContext(evidence:EvidenceRecordData[]){
 const index=buildAtomEvidenceIndex(evidence);expandAtomEvidenceIndex(index);
 const quoteIndex=buildEvidenceIndex(evidence);expandEvidenceIndex(quoteIndex);
 type Payload={evidence?:EvidenceRecordData[];atomEvidenceIndex?:z.infer<typeof AtomEvidenceIndex>;evidenceIndex?:ReturnType<typeof buildEvidenceIndex>};
 const originalBytes=Buffer.byteLength(JSON.stringify({evidence}));
 const candidates:{payload:Payload;instructions:string;encoded:boolean}[]=[{payload:{evidence},instructions:'',encoded:false},{payload:{atomEvidenceIndex:index},instructions:ATOM_INDEX_INSTRUCTIONS,encoded:true},{payload:{evidenceIndex:quoteIndex},instructions:INDEX_INSTRUCTIONS,encoded:true}];
 const size=(c:typeof candidates[number])=>Buffer.byteLength(JSON.stringify(c.payload)+c.instructions);
 const selected=candidates.sort((a,b)=>size(a)-size(b))[0];
 return {encoded:selected.encoded,originalBytes,actualBytes:size(selected),payload:selected.payload};
}
