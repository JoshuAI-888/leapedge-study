import {createHash} from 'node:crypto';
import {z} from 'zod';
import {CoverageImpact,planCoverageReuse} from './targeted-coverage-reuse.ts';
import {ResearchAudit,ResearchAuditResponse,ResearchDraft,EvidenceRecord,validateBrief,ExternalEvidence,AnalysisContext,BaselinePoint} from '../../features/youtube-intelligence/research-brief.ts';
const VerdictResponse = ResearchAuditResponse.pick({verdicts:true,coverageFindings:true}).extend({verdicts:ResearchAuditResponse.shape.verdicts.max(12)});
const TargetedVerdictResponse = VerdictResponse.extend({coverageImpact:CoverageImpact.optional()});
const CoverageResponse = ResearchAuditResponse.pick({evidenceCoverage:true,coverageFindings:true}).extend({evidenceCoverage:ResearchAuditResponse.shape.evidenceCoverage.max(8)});
const Job = z.object({kind:z.enum(['verdict','coverage']),ids:z.array(z.string()),originalIds:z.array(z.string()).optional(),stage:z.string(),attempts:z.array(ResearchAudit),status:z.enum(['pending','repair','complete','failed']),error:z.string().optional(),requests:z.number().int().nonnegative().default(0),impacts:z.array(CoverageImpact.nullable()).optional()});
const State = z.object({version:z.literal('research-audit.batch.v1'),hash:z.string(),jobs:z.array(Job),plannedCalls:z.number(),maxCalls:z.number(),note:z.string(),reuse:z.object({reused:ResearchAudit.shape.evidenceCoverage,reassessIds:z.array(z.string())}).optional()});
type Audit = z.infer<typeof ResearchAudit>;
type Input = {draft:z.infer<typeof ResearchDraft>;retainedDraft:z.infer<typeof ResearchDraft>;evidence:z.infer<typeof EvidenceRecord>[];previousAudit:Audit|null;payload:Record<string,unknown>;instructions:string;identity:unknown;targeted?:{previousBasis?:unknown;context:unknown}};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function answers(job:z.infer<typeof Job>) {
 const map = new Map<string,Audit['verdicts'][number]|Audit['evidenceCoverage'][number]>();
 for(const attempt of job.attempts){
  const entries=job.kind==='verdict'?attempt.verdicts:attempt.evidenceCoverage;
  for(const id of job.ids){if(map.has(id))continue;const found=entries.filter(entry=>('id'in entry?entry.id:entry.evidenceId)===id);if(found.length===1)map.set(id,found[0]);}
 }
 return map;
}
/** One paid job per call; caller persists run.output after every returned step.
 * modelCall remains responsible for ledger holds and exact paid-response replay. */
export async function advanceBoundedResearchAudit(output:Record<string,unknown>,key:string,input:Input,invoke:(stage:string,instructions:string,payload:unknown,schema:z.ZodType)=>Promise<unknown>):Promise<{done:false}|{done:true;audit:Audit;attempts:Audit[]}> {
 const hash=digest({version:'research-audit.batch.v1',...input});
 let state:z.infer<typeof State>;
 if(output[key]) {state=State.parse(output[key]);if(state.hash!==hash)throw Error('Bounded audit input changed; preserve prior paid attempt and create an explicit new plan.');}
 else {
  const jobs:z.infer<typeof Job>[]=[];
  for(const [kind,ids,size]of [['verdict',input.draft.sentences.map(s=>s.id),12],['coverage',input.evidence.map(e=>e.id),8]] as const){
   if(new Set(ids).size!==ids.length)throw Error('Duplicate bounded audit target ID.');
   for(let i=0;i<ids.length;i+=size)jobs.push({kind,ids:ids.slice(i,i+size),stage:`critique-research-${key}-${kind}-${i/size}-${hash.slice(0,12)}`,attempts:[],status:'pending',requests:0});
  }
  state={version:'research-audit.batch.v1',hash,jobs,plannedCalls:jobs.length,maxCalls:jobs.length*2,note:'Verdict batches retain full source/external context; coverage batches review every assigned original evidence item against the full retained draft. Additional calls/costs are recorded, not claimed as speed savings.'};
  output[key]=state;return {done:false}; // persist immutable plan before any paid request
 }
 output[key]=state;
 if(input.targeted&&input.previousAudit&&!state.reuse&&state.jobs.filter(j=>j.kind==='verdict').every(j=>j.status==='complete')) {
  const verdictJobs=state.jobs.filter(j=>j.kind==='verdict');
  const verdicts=[...input.previousAudit.verdicts,...verdictJobs.flatMap(j=>[...answers(j).values()] as Audit['verdicts'])];
  const acceptedIds=validateBrief(input.retainedDraft,input.evidence,z.array(ExternalEvidence).parse(input.payload.external??[]),AnalysisContext.parse(input.payload.context),verdicts,z.array(BaselinePoint).parse(input.payload.baseline??[])).sentences.map(s=>s.id);
  const accepted=input.retainedDraft.sentences.filter(s=>acceptedIds.includes(s.id));
  const basis=z.object({evidence:z.array(EvidenceRecord),accepted:ResearchDraft.shape.sentences,context:z.unknown()}).safeParse(input.targeted.previousBasis);
  const impacts=verdictJobs.flatMap(j=>j.impacts??[null]);
  const priorIds=new Set(basis.success?basis.data.accepted.map(s=>s.id):[]);
  const newAccepted=accepted.filter(s=>!priorIds.has(s.id)).map(s=>s.id);
  const answered=impacts.flatMap(i=>i?.sentenceIds??[]);
  const known=impacts.every(i=>i?.complete)&&new Set(answered).size===answered.length&&verdictJobs.flatMap(j=>j.ids).every(id=>answered.includes(id))&&answered.every(id=>verdictJobs.some(j=>j.ids.includes(id)));
  state.reuse=planCoverageReuse({evidence:input.evidence,priorEvidence:basis.success?basis.data.evidence:[],priorCoverage:input.previousAudit.evidenceCoverage,priorAccepted:basis.success?basis.data.accepted:[],accepted,priorContext:basis.success?basis.data.context:null,context:input.targeted.context,impact:known?{complete:true,sentenceIds:newAccepted,affectedEvidenceIds:[...new Set(impacts.flatMap(i=>i?.affectedEvidenceIds??[]))]}:null});
  // Original plan and paid stages stay addressable. Reused rows are not manufactured model attempts.
  for(const job of state.jobs.filter(j=>j.kind==='coverage')) {job.originalIds=[...job.ids];job.ids=job.ids.filter(id=>state.reuse!.reassessIds.includes(id));if(!job.ids.length)job.status='complete';}
  state.note+=' Targeted supplement: retained covered assessments reuse explicit stable accepted dependencies only after complete full-inventory impact assessment. Unknown and incomplete evidence always reassessed.';
  return {done:false};
 }
 const job=state.jobs.find(j=>j.status!=='complete');
 if(job){
  if(job.status==='failed')throw Error(job.error??'Bounded audit failed; explicit recovery required.');
  const existing=answers(job),ids=job.ids.filter(id=>!existing.has(id));
  const repairing=job.status==='repair';
  const acceptedVerdicts=[...(input.previousAudit?.verdicts??[]),...state.jobs.filter(j=>j.kind==='verdict').flatMap(j=>[...answers(j).values()] as Audit['verdicts'])];
  const applicationReview=job.kind==='coverage'?validateBrief(input.retainedDraft,input.evidence,z.array(ExternalEvidence).parse(input.payload.external??[]),AnalysisContext.parse(input.payload.context),acceptedVerdicts,z.array(BaselinePoint).parse(input.payload.baseline??[])):null;
  const payload=job.kind==='verdict'?{...input.payload,draft:{...input.draft,sentences:input.draft.sentences.filter(s=>ids.includes(s.id))},retainedDraft:input.retainedDraft,requestedSentenceIds:ids,scope:'Audit only requested sentences; inspect full retained source, draft, external and baseline context. Return verdicts and findings only; no coverage output.'}:{context:input.payload.context,sourceRunId:input.payload.sourceRunId,evidence:input.evidence.filter(e=>ids.includes(e.id)),retainedDraft:input.retainedDraft,modelVerdicts:acceptedVerdicts,applicationAcceptedSentenceIds:applicationReview!.sentences.map(s=>s.id),applicationRejectedSentences:applicationReview!.rejected,requestedEvidenceIds:ids,scope:'Assess every requested original evidence item against only applicationAcceptedSentenceIds in the full retained draft. Model verdicts are retained diagnostics, not publication authority. Every assigned quote/condition/risk is intact; do not infer coverage merely from a citation. Return coverage and findings only; no sentence verdicts.'};
  const impactInstruction=input.targeted&&input.previousAudit&&job.kind==='verdict'?' Also return coverageImpact: complete, sentenceIds (exactly every requested sentence ID), affectedEvidenceIds. Independently assess each requested sentence against EVERY supplied evidence item, including uncited, indirect, contradictory and cross-topic relationships that could change whether previous coverage remains valid. List every potentially affected evidence ID. Set complete false if influence cannot be assessed exhaustively; uncertain relevance is affected, not safe. This impact assessment does not assert coverage.':'';
  const instructions=input.instructions+impactInstruction+(job.kind==='verdict'?' OVERRIDE response scope: one verdict per requestedSentenceId only; do not return evidenceCoverage.':' OVERRIDE response scope: one evidenceCoverage per requestedEvidenceId only; inspect full original quotes and accepted/rejected verdicts against retainedDraft. Unknown is explicit uncertainty, not covered. Do not return verdicts.');
  try {
   job.requests++;
   const raw=await invoke(job.stage+(repairing?'-missing-1':''),instructions,payload,job.kind==='verdict'?(input.targeted&&input.previousAudit?TargetedVerdictResponse:VerdictResponse):CoverageResponse);
   const parsed=job.kind==='verdict'?(input.targeted&&input.previousAudit?TargetedVerdictResponse:VerdictResponse).parse(raw):CoverageResponse.parse(raw);
   if(input.targeted&&input.previousAudit&&job.kind==='verdict'){const impact=TargetedVerdictResponse.parse(raw).coverageImpact;const valid=impact&&new Set(impact.sentenceIds).size===impact.sentenceIds.length&&impact.sentenceIds.length===ids.length&&impact.sentenceIds.every(id=>ids.includes(id))&&impact.affectedEvidenceIds.every(id=>input.evidence.some(e=>e.id===id));(job.impacts??=[]).push(valid?impact:null);}
   const attempt=ResearchAudit.parse({verdicts:[],evidenceCoverage:[],...parsed});job.attempts.push(attempt);
   const returned=job.kind==='verdict'?attempt.verdicts.map(v=>v.id):attempt.evidenceCoverage.map(e=>e.evidenceId);
   if(returned.some(id=>!ids.includes(id)))throw Error('Bounded audit returned foreign target IDs; no verdict or coverage can be silently reassigned.');
   const missing=job.ids.filter(id=>!answers(job).has(id));
   if(missing.length){if(repairing)throw Error(`Incomplete bounded audit after one missing-ID repair: ${missing.join(', ')}.`);job.status='repair';}
   else job.status='complete';
  }catch(error){job.status='failed';job.error=error instanceof Error?error.message:String(error);throw error;}
  return {done:false}; // one modelCall maximum, then persistent checkpoint
 }
 const findings=[...new Set([...(state.reuse?input.previousAudit?.coverageFindings??[]:[]),...state.jobs.flatMap(j=>j.attempts.flatMap(a=>a.coverageFindings))])];
 const audit=ResearchAudit.parse({verdicts:state.jobs.filter(j=>j.kind==='verdict').flatMap(j=>[...answers(j).values()]),evidenceCoverage:[...(state.reuse?.reused??[]),...state.jobs.filter(j=>j.kind==='coverage').flatMap(j=>[...answers(j).values()])],coverageFindings:findings.length>30?[findings.join('\n')]:findings});
 if(input.targeted&&!input.previousAudit)output.researchCoverageBasis={evidence:input.evidence,accepted:input.retainedDraft.sentences.filter(s=>validateBrief(input.retainedDraft,input.evidence,z.array(ExternalEvidence).parse(input.payload.external??[]),AnalysisContext.parse(input.payload.context),audit.verdicts,z.array(BaselinePoint).parse(input.payload.baseline??[])).sentences.some(a=>a.id===s.id)),context:input.targeted.context};
 return {done:true,audit,attempts:state.jobs.flatMap(j=>j.attempts)};
}
