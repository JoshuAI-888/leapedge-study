import { registry, renderSteps } from "../../metrics/registry.ts";
import { PageTitle } from "../components.tsx";
import { EXPORT_CAP, EXPORT_COLUMNS } from "../../export-columns.ts";
export function Methodology() {
  return (
    <>
      <PageTitle
        title="Methodology"
        description="Every figure has a definition, an input source, and a reproducible calculation."
      />
      <section className="yi-panel">
        <h2>How to read the evidence</h2>
        <p>
          Creator conviction describes the creator's certainty. Trust describes
          the checks our evidence passed. Neither predicts an investment
          outcome.
        </p>
        <p>
          Forward and historical results are kept separate. Rankings need
          sufficient settled calls and statistical support; an insufficient
          sample is never shown as a zero return.
        </p>
        <p>
          LeapEdge comparisons measure agreement and usefulness, not
          independently verified accuracy.
        </p>
      </section>
      {registry.map((m) => (
        <section id={m.id} className="yi-panel" key={m.id}>
          <h2>{m.label}</h2>
          <p>{m.definition}</p>
          <pre className="yi-method-steps">{renderSteps(m)}</pre>
          <p className="yi-muted">
            Inputs:{" "}
            {m.inputs
              .map((i) => `${i.table}: ${i.columns.join(", ")}`)
              .join(" · ")}
          </p>
          {m.settingsUsed.length > 0 && (
            <p className="yi-muted">Settings: {m.settingsUsed.join(", ")}</p>
          )}
        </section>
      ))}
      <section id="export-columns" className="yi-panel">
        <h2>Export columns</h2>
        <p>
          Search exports every call matching its filters as CSV or JSON, up to{" "}
          {EXPORT_CAP.toLocaleString("en-US")} calls; a longer set is cut and the
          file says so. The CSV has one row per call in this column order, then
          lines starting with # that state the filters, the trust basis and that
          trust describes the evidence, not investment quality. Cells that a
          spreadsheet would run as a formula start with an apostrophe. The JSON
          holds the same facts and nests each call&apos;s evidence spans with
          their timestamped links.
        </p>
        <dl className="yi-export-columns">
          {EXPORT_COLUMNS.map((c) => (
            <div key={c.id}>
              <dt>
                <code>{c.id}</code>
              </dt>
              <dd>{c.description}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
