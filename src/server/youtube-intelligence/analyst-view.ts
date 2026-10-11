import { resolveReference } from "./listings/resolve.ts";
import {
  buildAnalystView,
  analystNote,
  AnalystView,
  CheckedFindings,
  type AnalystViewData,
} from "../../features/youtube-intelligence/analyst-view.ts";
import { Claim, Source, deriveEvidence, type CheckedClaim, type MentionData, type Run, type SourceData } from "../../features/youtube-intelligence/contracts.ts";
import type { ResearchBriefData } from "../../features/youtube-intelligence/research-brief.ts";
import {AuditedExecutionPlan} from "../../features/youtube-intelligence/audited-execution.ts";
import {researchEvidenceInventoryWithDiagnostics} from './research-evidence-inventory.ts';
import {sourceQuantityProseIssues} from '../../features/youtube-intelligence/research-numeric-check.ts';
import {sourceAttributionCheck} from '../../features/youtube-intelligence/research-attribution.ts';

/** The analyst view of one analysis run, with listings resolved here on the server. */
export function analystViewFor(
  run: Run,
  brief: ResearchBriefData | null,
  bottomLine: { sentences: { text: string; statementIds: string[] }[] } | null = null,
) {
  const claims = (run.output.claims ?? []) as CheckedClaim[];
  const mentions = (run.output.mentions ?? []) as MentionData[];
  const source = run.output.source as SourceData | undefined;
  const proposals = new Map(
    ((run.output.tickerProposals ?? []) as { id?: string; proposedTicker?: string }[]).map((p) => [p.id, p.proposedTicker ?? null]),
  );
  const metadata = (run.output.metadata ?? {}) as { channel?: string; publishedAt?: string };
  const view = buildAnalystView({
    title: run.title,
    channel: metadata.channel ?? null,
    publishedAt: metadata.publishedAt ?? null,
    claims,
    mentions,
    mentionChecks: run.output.mentionChecks as Record<string, boolean> | undefined,
    claimListings: Object.fromEntries(
      claims.map((c) => [
        c.id,
        resolveReference(c.claim.instrument_as_spoken ?? c.claim.ticker, c.claim.ticker ?? proposals.get(c.id) ?? null, {
          explicit: c.claim.ticker_explicit,
        }),
      ]),
    ),
    mentionListings: mentions.map((m) => resolveReference(m.instrument_as_spoken, m.ticker)),
    brief,
    segmentSeconds: Object.fromEntries((source?.segments ?? []).map((s) => [s.id, s.start_seconds])),
    bottomLine: bottomLine?.sentences ?? null,
    transcriptionDoubts: (run.output.transcriptionDoubts ?? []) as { heard: string; likely: string; reason_en: string; start_seconds?: number | null }[],
  });
  return { view, note: analystNote(view) };
}

/** A read-only publication projection, never an extraction or a synthetic child
 * brief. A checked source item may be shown while full coverage is unfinished;
 * candidate text and source pointers must each pass their own boundary. */
export function checkedFindingsEnabledFor(run:Run) {
  const rawPlan=run.input.auditedExecutionPlan as Record<string,unknown>|undefined;
  const plan=AuditedExecutionPlan.safeParse(rawPlan);
  return !run.input.task && rawPlan?.checkedFindings===true && plan.success && plan.data.checkedFindings;
}
export function checkedFindingsRevisionFor(run:Run) {
  const revision=run.output.checkedFindingsRevision;
  return checkedFindingsEnabledFor(run) && typeof revision==='number' && Number.isInteger(revision) && revision>0 && revision<=999999999 ? revision : 0;
}
export function checkedFindingsFor(run:Run) {
  const revision=checkedFindingsRevisionFor(run);
  if(!revision)return null;
  const source=Source.safeParse(run.output.source);
  if(!source.success)return null;
  const accepted=(raw:unknown):CheckedClaim[]=>Array.isArray(raw) ? raw.flatMap(value=>{
    const item=value as Partial<CheckedClaim>|null;
    if(!item || typeof item.id!=='string' || !item.id || item.passed!==true || !Array.isArray(item.reasons) || item.reasons.length || item.audit?.verdict!=='accept')return [];
    const claim=Claim.safeParse(item.claim);
    if(!claim.success)return [];
    try {
      for(const quote of claim.data.evidence) {
        const pointer=quote.source_span;
        // New opted-in runs use copied pointer evidence. Historical freehand
        // quotes are still retained in processing detail, never promoted here.
        if(!pointer || pointer.start_id!==quote.segment_id || pointer.end_id!==(quote.end_segment_id??quote.segment_id))return [];
        const original=deriveEvidence(source.data,pointer);
        if(original.quote_original!==quote.quote_original || original.text_hash!==pointer.text_hash || original.start_seconds!==pointer.start_seconds || original.end_seconds!==pointer.end_seconds)return [];
      }
      const text=[claim.data.thesis_en,...claim.data.conditions_en,...claim.data.risks_en].join(' ');
      const evidence=claim.data.evidence.map((q,index)=>({id:`e${index}`,quotes:[{text:q.quote_original}]}));
      if(sourceQuantityProseIssues({text},claim.data.evidence.map(q=>q.quote_original)).length || sourceAttributionCheck({text,speaker:'unknown',evidenceIds:evidence.map(e=>e.id)},evidence).requiresNeutralRepair)return [];
      return [{id:item.id,claim:claim.data,passed:true,reasons:[],audit:item.audit}];
    } catch {return [];}
  }) : [];
  const claims=accepted(run.output.claims),keyPoints=accepted(run.output.keyPoints);
  // Mention inventory independently verifies explicit acceptance and every
  // original range. Preserve original order/IDs rather than reindexing it.
  const retained={...run,output:{...run.output,claims,keyPoints}};
  const inventory=researchEvidenceInventoryWithDiagnostics(retained);
  const ids=new Set<string>();
  const evidence=inventory.evidence.filter(item=>{
    if(ids.has(item.id))return false;
    ids.add(item.id);
    if(item.id.startsWith('m') && !claims.some(c=>c.id===item.id) && !keyPoints.some(c=>c.id===item.id)) {
      const quotes=item.quotes.map(q=>q.text);
      if(sourceQuantityProseIssues({text:item.summary},quotes).length || sourceAttributionCheck({text:item.summary,speaker:'unknown',evidenceIds:[item.id]},[item]).requiresNeutralRepair)return false;
    }
    return true;
  });
  if(!evidence.length)return null;
  // Root selector handles canonical listings/heading; only accepted root claims
  // enter it. Context is projected below without inventing a trade or stance.
  const base=analystViewFor({...retained,output:{...retained.output,mentions:[],transcriptionDoubts:[]}},null).view;
  type Point=AnalystViewData['sections'][number]['points'][number];
  const points:Point[]=evidence.flatMap(item=>{
    const claim=[...claims,...keyPoints].find(c=>c.id===item.id)?.claim;
    const resolved=resolveReference(item.instrument??item.ticker,item.ticker,{explicit:claim?.ticker_explicit});
    const topic=resolved?.symbol ?? resolved?.name ?? item.ticker ?? item.instrument ?? 'Research context';
    const references=item.quotes.map(q=>({evidenceId:item.id,startId:q.startId,endId:q.endId,text:q.text,at:q.start}));
    const speaker=claim?.owner ?? 'unknown';
    const make=(text:string,kind:string,suffix:string):Point=>({id:`${item.id}:${suffix}`,text,topic,kind,speaker,at:references.length===1 ? references[0].at:null,references});
    // Literal fields only. Every material condition survives; summary selection
    // is a reading aid and never caps the publication or the source references.
    return [make(item.summary,item.kind==='creator_call'?'creator_view':'analysis','thesis'),
      ...(claim?.owner_name?[make(`Attributed to: ${claim.owner_name}`,'reported_fact','owner')]:[]),
      ...(claim?.action?[make(`Action: ${claim.action.replaceAll('_',' ')}`,'reported_fact','action')]:[]),
      ...item.conditions.map((text,index)=>make(text,'condition',`condition${index}`)),
      ...item.risks.map((text,index)=>make(text,'countercase',`risk${index}`)),
      ...item.levels.map((level,index)=>make(`${level.kind}: ${level.value_original}${claim?.levels[index]?.condition_en ? ` — ${claim.levels[index].condition_en}`:''}`,'scenario',`level${index}`)),
      ...(item.horizon?[make(`Horizon: ${item.horizon}`,'reported_fact','horizon')]:[]),
      ...(claim?.size_original?[make(`Size: ${claim.size_original}`,'reported_fact','size')]:[]),
      ...(claim?.option?[make(`Option: ${[claim.option.side,claim.option.right,claim.option.strike_original,claim.option.expiry_original&&`expiry ${claim.option.expiry_original}`,claim.option.premium_original&&`premium ${claim.option.premium_original}`].filter(Boolean).join(' · ')}`,'reported_fact','option')]:[]),
      ...(claim?.catalysts??[]).map((c,index)=>make(`Catalyst: ${c.text_en}${c.date_original?` (${c.date_original})`:''}`,'reported_fact',`catalyst${index}`)),
      ...(claim?.expiry?[make(`Review/expiry: ${claim.expiry.original}`,'next_check','expiry')]:[]),
    ];
  });
  const leadingClaimId=base.ideas[0]?.claimIds[0];
  const first=points.find(p=>p.id===`${leadingClaimId}:thesis`)??points.find(p=>p.kind==='creator_view')??points[0];
  const driver=points.find(p=>p.kind==='analysis'&&p.topic===first.topic)??points.find(p=>p.kind==='analysis');
  const countercase=points.find(p=>p.kind==='countercase'&&p.topic===first.topic)??points.find(p=>p.kind==='countercase'||p.kind==='next_check');
  const overview=[first,driver,countercase].filter((p):p is Point=>!!p).filter((p,index,all)=>all.findIndex(q=>q.id===p.id)===index);
  const sectionKey=(point:Point)=>point.kind==='countercase'?'countercase':point.kind==='next_check'?'next_checks':point.kind==='scenario'?'valuation':'thesis';
  const sections:AnalystViewData['sections']=([['thesis','Thesis'],['valuation','Valuation and scenario'],['countercase','Countercase'],['next_checks','Next checks']] as const)
    .map(([key,title])=>({key,title,points:points.filter(p=>sectionKey(p)===key).sort((a,b)=>Number(b.topic===first.topic)-Number(a.topic===first.topic))}));
  sections.push({key:'evidence',title:'Evidence',points});
  const view=AnalystView.parse({...base,heading:`${first.topic} — ${first.text}`,publicationState:'coverage_in_progress',sections,
    summary:overview.map(p=>({text:p.text,at:p.at,references:p.references})),ideas:[],sentiment:[],otherMentions:[],keyPoints:[],themes:[],numbers:[],watchOuts:[],diagnostics:['Full-source coverage and the independently reviewed research brief are still in progress.']});
  return CheckedFindings.parse({revision,view,note:analystNote(view)});
}
