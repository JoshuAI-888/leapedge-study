import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const comparisonTimingSchema = z.object({
 boundary:z.enum(['ingestion-to-terminal','retained-transcript-to-terminal','recovery-to-terminal','research-only','unknown']),
 seconds:z.number().nonnegative().nullable(), includesQueue:z.boolean(), includesBrowser:z.boolean(),
});
export const comparisonAttemptSchema = z.object({
 id:z.string(), runId:z.string(), cohort:z.string(), status:z.string(), stage:z.string(),
 createdAt:z.string(), updatedAt:z.string(), error:z.string().nullable(), model:z.string(), promptVersion:z.string(),
 configSha256:hash, transcriptSha256:hash.nullable(), outputSha256:hash,
 artifact:z.object({path:z.string(),sha256:hash}), timing:comparisonTimingSchema,
 cost:z.object({settledUsd:z.number().nonnegative().nullable(),unsettledCalls:z.number().int().nonnegative(),scope:z.string()}),
 acceptedClaims:z.number().int().nonnegative().nullable(), acceptedSentences:z.number().int().nonnegative().nullable(),
 coverageFindings:z.array(z.string()), outputSummary:z.array(z.string()),
 outputKind:z.enum(["published-research","model-audited-draft","source-claims","none"]),
 modelAcceptedDraftSentences:z.number().int().nonnegative().nullable(),
}).superRefine((attempt,ctx)=>{
 if(attempt.outputKind!=="published-research" && attempt.acceptedSentences!==null)ctx.addIssue({code:"custom",message:"Only retained published research can have accepted sentence counts"});
 if(attempt.outputKind==="published-research" && attempt.acceptedSentences!==attempt.outputSummary.length)ctx.addIssue({code:"custom",message:"Published count must match retained final text"});
});
export const comparisonManifestSchema = z.object({
 version:z.literal('comparison-readiness.v1'), generatedAt:z.string(), limitations:z.array(z.string()),
 ledger:z.array(z.object({id:z.string(),runId:z.string(),status:z.string(),amount:z.number().nonnegative().nullable()})),
 cases:z.array(z.object({
 case:z.number().int().positive(),videoId:z.string(),title:z.string(),channel:z.string(),url:z.string().url(),
 leapedge:z.object({status:z.string(),reportUrl:z.string().url().nullable(),capturedAt:z.string().nullable(),reportSha256:hash.nullable(),displayedUsd:z.number().nonnegative().nullable(),durationSeconds:z.number().nonnegative().nullable(),timingBoundary:z.literal('unknown'),assessment:z.string(),summaryExcerpt:z.string().nullable()}),
 attempts:z.array(comparisonAttemptSchema),qualityChecks:z.array(z.object({id:z.string(),status:z.enum(['unassessed','pass','fail']),description:z.string()})),originalAssessment:z.string(),
 })).length(20),
}).superRefine((value,ctx)=>{
 if(new Set(value.cases.map(c=>c.videoId)).size!==value.cases.length)ctx.addIssue({code:'custom',message:'Duplicate case video'});
 if(new Set(value.cases.map(c=>c.case)).size!==value.cases.length)ctx.addIssue({code:'custom',message:'Duplicate case number'});
});
export type ComparisonManifest = z.infer<typeof comparisonManifestSchema>;
export type ComparisonAttempt = z.infer<typeof comparisonAttemptSchema>;
export function comparableTiming(a:z.infer<typeof comparisonTimingSchema>,b:z.infer<typeof comparisonTimingSchema>):boolean {
 return a.boundary!=='unknown' && a.boundary===b.boundary && a.seconds!==null && b.seconds!==null && a.includesQueue===b.includesQueue && a.includesBrowser===b.includesBrowser;
}
export function summarizeComparison(manifest:ComparisonManifest) {
 const attempts=manifest.cases.flatMap(c=>c.attempts);
 const ledger=new Map<string,ComparisonManifest['ledger'][number]>();
 for(const call of manifest.ledger){
  const prior=ledger.get(call.id);
  if(prior && JSON.stringify(prior)!==JSON.stringify(call))throw new Error(`Conflicting ledger entry ${call.id}`);
  ledger.set(call.id,call);
 }
 return {cases:manifest.cases.length,observations:attempts.length,uniqueRuns:new Set(attempts.map(a=>a.runId)).size,
 failedObservations:attempts.filter(a=>a.status==='failed').length,
 reviewObservations:attempts.filter(a=>a.status==='needs_review').length,
 knownLedgerUsd:[...ledger.values()].reduce((n,c)=>n+(c.status==='completed'?(c.amount??0):0),0),
 unsettledCalls:[...ledger.values()].filter(c=>!['completed','released','failed'].includes(c.status)).length,
 browserMeasuredCases:manifest.cases.filter(c=>c.attempts.some(a=>a.timing.includesBrowser)).length,
 retainedLeapedgeReports:manifest.cases.filter(c=>c.leapedge.reportSha256!==null).length,
 missingLeapedgeTiming:manifest.cases.filter(c=>c.leapedge.durationSeconds===null).length,
 };
}
