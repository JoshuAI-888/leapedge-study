import { z } from "zod";
import { TransportKind, type ModelTransport } from "./types.ts";
import { OpenRouterTransport } from "./openrouter.ts";
import { GoogleNativeTransport } from "./google-native.ts";
export * from "./types.ts";
export { OpenRouterTransport } from "./openrouter.ts";
export { GoogleNativeTransport } from "./google-native.ts";
/**
 * transportFor(stage, settings) picks the transport a stage calls through.
 * Both stock transports are registered; the default is still OpenRouter, so
 * nothing moves to the native Gemini API until per-stage routing lands (F11).
 * The settings shape below is the subset of spec 6.2 needed to name a
 * transport, so routing per stage can grow without changing callers.
 *
 * Tests inject a transport with injectTransport(fake) and undo it with the
 * returned function; the pipeline never knows the difference.
 */
export const TransportSettings = z
  .object({
    transport: z
      .object({
        default: TransportKind.exclude(["fake"]).optional(),
        fallbackToOpenRouter: z.boolean().optional(),
      })
      .optional(),
  })
  .partial();
export type TransportSettingsData = z.infer<typeof TransportSettings>;
export type TransportFactory = (
  stage: string,
  settings: TransportSettingsData,
) => ModelTransport;
const openrouter = new OpenRouterTransport();
const googleNative = new GoogleNativeTransport();
// Neither constructor reads a key or opens a socket; both are shared instances.
const stock: Partial<Record<TransportKind, () => ModelTransport>> = {
  openrouter: () => openrouter,
  "google-native": () => googleNative,
};
let override: TransportFactory | null = null;
export function transportFor(stage: string, settings?: unknown): ModelTransport {
  const parsed = TransportSettings.parse(settings ?? {});
  if (override) return override(stage, parsed);
  const kind = parsed.transport?.default ?? "openrouter";
  const make = stock[kind];
  if (!make) throw Error(`Transport "${kind}" is not available yet.`);
  return make();
}
/** Test seam: route every stage through the given transport (or factory) until the returned function is called. */
export function injectTransport(
  transport: ModelTransport | TransportFactory | null,
): () => void {
  const previous = override;
  override =
    transport === null
      ? null
      : typeof transport === "function"
        ? transport
        : () => transport;
  return () => {
    override = previous;
  };
}
