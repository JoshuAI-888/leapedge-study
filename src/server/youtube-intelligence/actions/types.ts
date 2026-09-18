import { z } from "zod";
/**
 * One row of a resource's dispatch table. `schema` is the action's own input,
 * so nothing an action does not declare can reach its handler, and `mutating`
 * says whether running it writes — which is what lets the read-only preview
 * refuse a write without anyone maintaining a list of action names.
 */
export type ActionEntry = {
  schema: z.ZodType;
  handler: (input: unknown) => Promise<unknown>;
  mutating: boolean;
};
export type ActionTable = Record<string, ActionEntry>;
function entry<S extends z.ZodType>(
  mutating: boolean,
  schema: S,
  run: (input: z.output<S>) => unknown,
): ActionEntry {
  return {
    schema,
    mutating,
    handler: async (input) => await run(schema.parse(input)),
  };
}
/** An action that only reads, and so stays available in a read-only preview. */
export function reads<S extends z.ZodType>(
  schema: S,
  run: (input: z.output<S>) => unknown,
) {
  return entry(false, schema, run);
}
/** An action that writes. */
export function writes<S extends z.ZodType>(
  schema: S,
  run: (input: z.output<S>) => unknown,
) {
  return entry(true, schema, run);
}
/** The input of an action that declares none. */
export const nothing = z.union([z.undefined(), z.null()]);
