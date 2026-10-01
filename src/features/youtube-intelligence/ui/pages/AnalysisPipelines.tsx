import Link from "next/link";
import { RESEARCH_PIPELINES } from "../../research-pipeline-choice.ts";
import { PageTitle } from "../components.tsx";

export function AnalysisPipelines() {
  return <>
    <PageTitle title="Analysis pipelines" description="An explicit experiment in reducing repeated audit work. The current pipeline remains the default." />
    <section className="yi-panel">
      <h2>Choose a path for new analyses</h2>
      <p>This workspace setting is separate from processing efficiency profiles. Save team configuration in Settings to apply it. Queued and running analyses keep their frozen configuration; existing results and their audit history are unchanged. Resetting team configuration restores the current pipeline.</p>
      <Link href="/youtube-intelligence/settings">Back to Settings</Link>
    </section>
    {RESEARCH_PIPELINES.map(pipeline => <section className="yi-panel" key={pipeline.value}>
      <h2>{pipeline.label}</h2><p>{pipeline.description}</p>
      {pipeline.value === "targeted-experimental" && <>
        <p className="yi-warning">Experimental: no measured quality parity, speed gain or cost reduction is established. This is not a certification of investment readiness.</p>
        <p>The first experiment retains source extraction, initial drafting, and the full initial statement and coverage audit. After a repair, it reuses a prior coverage finding only when the evidence and its accepted-statement dependencies remain unchanged. Changed, missing or uncertain dependencies require reassessment. New statements still receive an audit.</p>
        <p>Identifying indirect effects still depends on the critic model and must be tested against source passages. The experimental path also separates statement and coverage checks into bounded batches for short videos, so it may take more calls or cost more on some inputs.</p>
      </>}
    </section>)}
    <section className="yi-panel">
      <h2>Safeguards in both paths</h2>
      <p>Extraction processes the transcript; research audits inspect the retained evidence inventory, which can omit material source details. The full retained transcript remains inspectable alongside original quotations and timestamps, rejected candidates, uncertainty, provider traces, attempts and costs. Inventory coverage does not establish full-transcript completeness. Unresolved gaps remain visible. Execution completion is not the same as research acceptance.</p>
      <p>Short- and long-term analysis retain equal weight in separate sections. Video-date research remains distinct from current updates. General research prioritises material developments across companies.</p>
      <h2>What must pass before a default change</h2>
      <p>The paired 20-video experiment measures fresh drafting and auditing from identical frozen retrieval results, retained transcripts, evidence inventories, models and date boundaries. Source acquisition, extraction, search and query planning are replayed inputs, excluded from these timing and cost gains; this is not an ingestion-to-display benchmark. Original transcript passages are the evidence; retained LeapEdge outputs are comparators, not ground truth. Failed attempts and their costs remain in the report.</p>
      <ul>
        <li>No unresolved critical errors, known critical failures corrected, and no material coverage regression.</li>
        <li>At least 30% lower median draft-and-audit processing time, an improved long-video time, and at least 25% lower median draft-and-audit cost including repairs, retries and failures.</li>
        <li>Preserved source drill-down, reliable recovery, desktop and mobile acceptance, and fully cloud deployment acceptance.</li>
      </ul>
      <p>These are experiment targets, not promised savings. Published evidence and explicit approval are required before promotion. The current path will remain selectable afterward.</p>
    </section>
  </>;
}
