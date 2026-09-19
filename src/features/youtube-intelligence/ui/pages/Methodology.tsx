import { registry, renderSteps } from "../../metrics/registry.ts";
import { PageTitle } from "../components.tsx";
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
    </>
  );
}
