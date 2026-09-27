/** Offline export only. Reads an explicit allowlist; never opens environments or contacts providers. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { comparisonManifestSchema, summarizeComparison, type ComparisonAttempt } from '../src/features/youtube-intelligence/comparison.ts';
const destination='docs/delivery/comparison-readiness-20260927';
const digest=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const record=z.record(z.string(),z.any());
const rawRun=z.object({id:z.string(),videoId:z.string(),status:z.string(),stage:z.string(),createdAt:z.string(),updatedAt:z.string(),error:z.string().nullable().optional(),model:z.string(),promptVersion:z.string(),input:record,output:record});
const rawCall=z.object({id:z.string(),run_id:z.string(),status:z.string(),amount:z.coerce.number().nullable()});
const retainedBrief=z.object({runId:z.string(),sentences:z.array(z.object({text:z.string()}))});
const artifactSchema=z.object({runs:z.array(rawRun),calls:z.array(rawCall),briefs:z.array(retainedBrief).optional(),timings:z.array(z.union([z.object({runId:z.string(),stage:z.string(),executionSeconds:z.number().nonnegative()}),z.object({run_id:z.string(),stage:z.string(),execution_ms:z.number().nonnegative()}).transform(t=>({runId:t.run_id,stage:t.stage,executionSeconds:t.execution_ms/1000}))])).optional()});
const originalSchema=z.object({cases:z.array(z.object({case:z.number(),videoId:z.string(),title:z.string(),channel:z.string(),assessment:z.string(),leapedgeStatus:z.string(),leapedgeReport:z.string().nullable(),leapedgeDisplayedUsd:z.number().nullable()}))});
const capturesSchema=z.object({captures:z.array(z.object({videoId:z.string(),at:z.string(),reportText:z.string()}))});
const artifacts=[
 'data/readiness-20260927/live-candidate.json',
 ...['b','c','d','e','f'].map(id=>`data/readiness-20260927/candidate-${id}-session-1.json`),
 'data/readiness-20260927/candidate-g-session-2.json',
 'data/comparison-20260920/results.json','data/recovery-20260920/results.json','data/recovery-final-20260920/results.json',
 'data/research-build-20260920/results.json','data/research-v8-20260920/results.json',
 'data/prod-sample-20260920/results.json','data/prod-resume-20260920/results.json',
 'data/operational-efficiency-20260920/live-sequential.json','data/operational-efficiency-20260920/live-sequential-mandarin.json','data/operational-efficiency-20260920/live-overlap.json',
];
const checklist=[
 ['attribution','Creator statements, holdings, hypothetical examples and analyst inference are distinguished.'],
 ['material-coverage','Material company views, valuation conditions, countercases, no-position qualifications and final-third content survive.'],
 ['external-entailment','Each corroboration label is supported by the exact cited external passage at the relevant date.'],
 ['numeric-conditions','Numbers, units, options expiry/strikes, arithmetic and conditional levels match source evidence.'],
 ['point-in-time','Video-date context and subsequent/current developments remain separate.'],
 ['observability','Every conclusion drills down to original transcript sections; withheld material and failed checks are visible.'],
];
if(process.argv.includes('--validate')){
 const manifest=comparisonManifestSchema.parse(JSON.parse(readFileSync(`${destination}.json`,'utf8')));
 console.log(JSON.stringify(summarizeComparison(manifest),null,2));
}else{
 const original=originalSchema.parse(JSON.parse(readFileSync('docs/delivery/live-comparison-20-20260920.json','utf8')));
 const captures=capturesSchema.parse(JSON.parse(readFileSync('data/comparison-20260920/leapedge-captures.json','utf8')));
 const loaded=artifacts.map(path=>{
  if(!existsSync(path))throw new Error(`Missing retained artifact: ${path}; export would be incomplete.`);
  const text=readFileSync(path,'utf8');return {path,sha256:digest(text),...artifactSchema.parse(JSON.parse(text))};
 });
 const videos=new Set(original.cases.map(c=>c.videoId));
 const runIds=new Set(loaded.flatMap(a=>a.runs.filter(r=>videos.has(r.videoId)).map(r=>r.id)));
 // Snapshots repeat the same ledger calls. Keep the latest retained state per call, not a sum of snapshots.
 const ledger=new Map<string,{id:string;runId:string;status:string;amount:number|null}>();
 for(const a of loaded)for(const c of a.calls)if(runIds.has(c.run_id))ledger.set(c.id,{id:c.id,runId:c.run_id,status:c.status,amount:c.amount});
 const cases=original.cases.map(c=>{
  const capture=captures.captures.filter(r=>r.videoId===c.videoId).at(-1);
  const attempts:ComparisonAttempt[]=loaded.flatMap(a=>a.runs.filter(r=>r.videoId===c.videoId).map(r=>{
   const calls=a.calls.filter(x=>x.run_id===r.id);const out=r.output;
   const research=r.input.task==='research-brief';
   const stageTimings=a.timings?.filter(t=>t.runId===r.id);
   const boundary=stageTimings?.length?'recorded-stage-execution':a.path.startsWith('data/comparison-')?'ingestion-to-terminal':a.path.includes('operational-efficiency')?(research?'research-only':'retained-transcript-to-terminal'):'unknown';
   const published=a.briefs?.find(b=>b.runId===r.id);
   const elapsed=(Date.parse(r.updatedAt)-Date.parse(r.createdAt))/1000;
   const verdicts=Array.isArray(out.researchAudit?.verdicts)?out.researchAudit.verdicts:null;
   return {id:`${a.path}:${r.id}`,runId:r.id,cohort:a.path.split('/')[1]+':'+a.path.split('/').at(-1),status:r.status,stage:r.stage,createdAt:r.createdAt,updatedAt:r.updatedAt,error:r.error??null,model:r.model,promptVersion:r.promptVersion,
    configSha256:digest(r.input),transcriptSha256:out.source?digest(out.source):null,outputSha256:digest(out),artifact:{path:a.path,sha256:a.sha256},
    timing:{boundary,seconds:boundary==='unknown'||!['completed','failed','needs_review'].includes(r.status)?null:stageTimings?.length?stageTimings.reduce((n,t)=>n+t.executionSeconds,0):Math.max(0,elapsed),includesQueue:boundary!=='recorded-stage-execution',includesBrowser:false},
    cost:{settledUsd:calls.length?calls.reduce((n,x)=>n+(x.status==='completed'?(x.amount??0):0),0):null,unsettledCalls:calls.filter(x=>!['completed','failed','released'].includes(x.status)).length,scope:'Cumulative retained ledger for this run observation; do not sum observations. Excludes unpriced transcript credits.'},
    acceptedClaims:Array.isArray(out.claims)?out.claims.filter((x:{passed?:boolean})=>x.passed).length:null,
    acceptedSentences:published?published.sentences.length:null,
    modelAcceptedDraftSentences:verdicts?verdicts.filter((x:{accepted?:boolean})=>x.accepted).length:null,
    outputKind:published?'published-research':verdicts?'model-audited-draft':Array.isArray(out.claims)?'source-claims':'none',
    outputSummary:published?published.sentences.map(x=>x.text):verdicts && Array.isArray(out.researchDraft?.sentences)?out.researchDraft.sentences.filter((x:{id:string})=>verdicts.some((v:{id:string;accepted:boolean})=>v.id===x.id&&v.accepted)).map((x:{text:string})=>x.text):Array.isArray(out.claims)?[...out.claims,...(Array.isArray(out.keyPoints)?out.keyPoints:[])].filter((x:{passed?:boolean})=>x.passed).map((x:{claim:{thesis_en:string}})=>x.claim.thesis_en):[],
    coverageFindings:Array.isArray(out.researchAudit?.coverageFindings)?out.researchAudit.coverageFindings.filter((x:unknown)=>typeof x==='string'):[],
   } as ComparisonAttempt;
  }));
  return {case:c.case,videoId:c.videoId,title:c.title,channel:c.channel,url:`https://www.youtube.com/watch?v=${c.videoId}`,
   leapedge:{status:c.leapedgeStatus,reportUrl:c.leapedgeReport,capturedAt:capture?.at??null,reportSha256:capture?digest(capture.reportText):null,displayedUsd:c.leapedgeDisplayedUsd,durationSeconds:null,timingBoundary:'unknown' as const,assessment:c.assessment,summaryExcerpt:capture?(capture.reportText.match(/SUMMARY ([^\n]+)/)?.[1]?.replace(/ KEY POINTS.*$/,'')??null):null},
   attempts,qualityChecks:checklist.map(([id,description])=>({id,description,status:'unassessed' as const})),originalAssessment:c.assessment};
 });
 const manifest=comparisonManifestSchema.parse({version:'comparison-readiness.v1',generatedAt:new Date().toISOString(),cases,ledger:[...ledger.values()],limitations:[
  'LeapEdge is a retained comparator, not ground truth. No new provider or LeapEdge calls were made.',
  'Attempt rows are retained run observations; the same run may appear in several snapshots. Earlier failures remain visible. Unique-call ledger totals avoid double billing repeated snapshots.',
  'Known ledger cost is not complete total spend: transcript credits, missing provider billing and unexported calls cannot be priced from these artifacts. Historical recorded prices are mixed across releases; this is not a consistent-price repricing.',
  'Published research counts/text come only from retained final brief records. Model-audited drafts are separately labelled and may contain sentences rejected by application validation; they are not published accepted output.',
  'Each duration ends at that run observation, not an entire parent-and-research-child flow. Extraction run timing excludes its separate research child. Recovery/research exports without a controlled start boundary retain null timing, even when creation timestamps exist.',
  'Unknown recovery boundaries have null duration. Created-to-updated duration includes queue where shown, excludes browser display and may include retries. Research-only and extraction replay are not fresh ingestion measurements.',
  'LeapEdge duration remains null because report timing boundaries were not captured consistently; no speedup ratio is asserted.',
  'Recorded-stage-execution is the sum of retained sequential stage durations for that run; it excludes acquisition, queue, inter-stage persistence and browser display. It is not URL-to-result latency. Failed stages and paid retry costs remain visible. Readiness candidate A uses retained stage durations only because its historical createdAt was overwritten; no elapsed wall-clock claim is made.',
  'All quality checks are unassessed: existing prose assessments are historical findings, not a new pass. Original and latest outputs require source-backed review.',
  'Artifacts are explicit retained exports only; this is not an inventory of every database call ever made. Model/settings/input and output hashes allow configuration/provenance checks without publishing private raw transcripts.',
 ]});
 writeFileSync(`${destination}.json`,JSON.stringify(manifest,null,2)+'\n');
 const summary=summarizeComparison(manifest);
 writeFileSync(`${destination}.md`,`# Retained 20-case comparison readiness\n\nGenerated ${manifest.generatedAt}. This is an offline provenance inventory, not a quality or performance pass.\n\n\`node --experimental-strip-types scripts/comparison-readiness.ts --validate\` validates the committed artifact without private inputs. Run without the flag to rebuild from the explicit private artifact allowlist. Missing inputs fail the export.\n\n${manifest.limitations.map(l=>'- '+l).join('\n')}\n\n## Inventory\n\n\`\`\`json\n${JSON.stringify(summary,null,2)}\n\`\`\`\n\n| Case | Video | Observations | Failed observations | LeapEdge |\n|---|---|---:|---:|---|\n${cases.map(c=>`| ${c.case} | ${c.videoId} | ${c.attempts.length} | ${c.attempts.filter(a=>a.status==='failed').length} | ${c.leapedge.status} |`).join('\n')}\n\n## Before claiming improvement\n\nReview the six per-case quality checks against retained transcripts and LeapEdge outputs. Run matched cold ingestion, transcript replay and warm-cache trials separately. Retain failed attempts and retries; measure first useful result and audited visible result separately. Never compare the sum of provider call durations with browser elapsed time. Historical observed deficiencies are recorded in operational-quality-20260920.md and adversarial-readiness-20260927.md; no checklist is automatically passed by a completed execution.\n`);
 console.log(JSON.stringify(summary,null,2));
}
