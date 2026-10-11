import type { EvidenceRecordData, ResearchSentenceData } from '../../features/youtube-intelligence/research-brief.ts';
import { buildEvidenceIndex, expandEvidenceIndex, INDEX_INSTRUCTIONS } from './research-evidence-index.ts';
import { buildAtomEvidenceIndex, expandAtomEvidenceIndex, ATOM_INDEX_INSTRUCTIONS } from './source-atom-index.ts';

export type FaithfulChunk = {
  sentences: ResearchSentenceData[];
  evidence: EvidenceRecordData[];
  assessEvidenceIds: string[];
  otherSentencesCitingAssessedEvidence: ResearchSentenceData[];
};
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
/** Encode exact data only when the complete payload plus decoding instructions
 * is smaller. Round-trip validation happens before a paid request. */
export function compactFaithfulPayload(chunk: FaithfulChunk) {
  const common = {
    sentences: chunk.sentences.map(({ id, text, evidenceIds, speaker, timeMode, kind, financialFacts }) => ({ id, text, evidenceIds, speaker, timeMode, kind, financialFacts })),
    assessEvidenceIds: chunk.assessEvidenceIds,
    otherSentencesCitingAssessedEvidence: chunk.otherSentencesCitingAssessedEvidence.map(({ id, text, evidenceIds }) => ({ id, text, evidenceIds })),
    note: 'Other sentences are coverage context only, not verdict targets. Prior accepted originals remain immutable; other batch candidates may be rejected. Return verdicts only for sentences and coverage only for assessEvidenceIds.'
  };
  const evidenceIndex = buildEvidenceIndex(chunk.evidence);
  expandEvidenceIndex(evidenceIndex);
  const atomEvidenceIndex = buildAtomEvidenceIndex(chunk.evidence);
  expandAtomEvidenceIndex(atomEvidenceIndex);
  const variants = [
    { payload: { ...common, evidence: chunk.evidence }, instructions: '' },
    { payload: { ...common, evidenceIndex }, instructions: INDEX_INSTRUCTIONS },
    { payload: { ...common, atomEvidenceIndex }, instructions: ATOM_INDEX_INSTRUCTIONS },
  ];
  return variants.sort((a,b) => bytes(a.payload)+Buffer.byteLength(a.instructions)-bytes(b.payload)-Buffer.byteLength(b.instructions))[0].payload;
}
const chunkBytes = (chunk: FaithfulChunk) => {
  const payload = compactFaithfulPayload(chunk);
  return bytes(payload)+Buffer.byteLength('evidenceIndex' in payload ? INDEX_INSTRUCTIONS : 'atomEvidenceIndex' in payload ? ATOM_INDEX_INSTRUCTIONS : '');
};
/** Enumerate at most four deterministic plans. Keep citations with their
 * coverage owner, including every citing retained sentence. Select the least
 * total input among plans fitting twelve targets and 24KB per job; when a
 * source alone exceeds that bound, preserve it and minimise peak size. */
export function compactFaithfulChunks(sentences: ResearchSentenceData[], evidence: EvidenceRecordData[], retained: ResearchSentenceData[] = []): FaithfulChunk[] {
  const all = [...sentences, ...retained];
  const cited = new Set(all.flatMap(s => s.evidenceIds));
  const assessed = evidence.filter(e => cited.has(e.id));
  if (!sentences.length && !assessed.length) return [];
  const materialise = (bins: ResearchSentenceData[][]) => {
    const owners = new Map<string, number>();
    bins.forEach((bin, index) => bin.forEach(s => s.evidenceIds.forEach(id => { if (!owners.has(id)) owners.set(id,index); })));
    const make = (index: number): FaithfulChunk => {
      const targets = new Set(bins[index].map(s=>s.id));
      const owned = new Set(assessed.filter(e=>owners.get(e.id)===index).map(e=>e.id));
      const needed = new Set([...owned,...bins[index].flatMap(s=>s.evidenceIds)]);
      return { sentences: bins[index], evidence: evidence.filter(e=>needed.has(e.id)), assessEvidenceIds:[...owned], otherSentencesCitingAssessedEvidence: all.filter(s=>!targets.has(s.id)&&s.evidenceIds.some(id=>owned.has(id))) };
    };
    for (const e of assessed) if (!owners.has(e.id)) {
      let best=0, lowest=Infinity;
      for(let i=0;i<bins.length;i++){owners.set(e.id,i);const size=chunkBytes(make(i));if(size<lowest){best=i;lowest=size;}}
      owners.set(e.id,best);
    }
    return bins.map((_,i)=>make(i)).filter(c=>c.sentences.length||c.assessEvidenceIds.length);
  };
  const plans = Array.from({length:4},(_,i)=> {
    const bins = Array.from({length:i+1},()=>[] as ResearchSentenceData[]);
    for (const s of [...sentences].sort((a,b)=>bytes(b)-bytes(a)||a.id.localeCompare(b.id))) {
      // Balance full encoded context, not raw repeated quote length.
      let best=0, lowest=Infinity;
      for(let j=0;j<bins.length;j++) {
        bins[j].push(s);
        const chunks=materialise(bins);
        const score=Math.max(...chunks.map(chunkBytes),0)+(bins[j].length>12?1e9:0);
        bins[j].pop();
        if(score<lowest){lowest=score;best=j;}
      }
      bins[best].push(s);
    }
    const chunks=materialise(bins), sizes=chunks.map(chunkBytes);
    return {chunks,total:sizes.reduce((a,b)=>a+b,0),peak:Math.max(...sizes,0),fits:chunks.every((c,j)=>c.sentences.length<=12&&sizes[j]<=24000)};
  });
  const adequate=plans.filter(p=>p.fits);
  return (adequate.length ? adequate.sort((a,b)=>a.total-b.total||a.peak-b.peak) : plans.sort((a,b)=>a.peak-b.peak||a.total-b.total))[0].chunks;
}
