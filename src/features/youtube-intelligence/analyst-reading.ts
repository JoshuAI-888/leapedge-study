import { z } from "zod";

const Revision = z.object({runId:z.string(),revision:z.number().int().nonnegative(),final:z.boolean()});
export type ReadingRevision = z.infer<typeof Revision>;
/** Detail polls may finish out of order within the same processing stage.
 * A final publication is immutable from the perspective of provisional delivery. */
export function acceptsReadingUpdate(current:ReadingRevision | null, incoming:ReadingRevision) {
  const next=Revision.parse(incoming);
  if(!current || current.runId!==next.runId) return true;
  const prior=Revision.parse(current);
  if(prior.final && !next.final) return false;
  return next.final || next.revision >= prior.revision;
}
