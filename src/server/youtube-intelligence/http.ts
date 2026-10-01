import { requestSession, workspaceOrigin } from "./access.ts";
import { serverTiming, withDatabaseTiming } from "./database.ts";
const loopback = ["localhost", "127.0.0.1", "[::1]"];
export function guard(request: Request) {
  if(process.env.YTI_PREVIEW_READ_ONLY === "true" && !["GET","HEAD"].includes(request.method))throw Error("This preview is read-only. Changes are tested in the isolated local workspace.");
  const origin = request.headers.get("origin"),
    host = request.headers.get("host") || new URL(request.url).host;
  const configured = workspaceOrigin();
  if (configured) {
    const app = new URL(configured);
    if (app.protocol !== "https:" && !loopback.includes(app.hostname))
      throw Error("Hosted workspace requires HTTPS.");
    if (host !== app.host || (origin && origin !== app.origin))
      throw Error("Cross-origin request denied.");
    if (!requestSession(request)) throw Error("Workspace access required.");
  } else {
    if (
      process.env.VERCEL ||
      !loopback.includes(new URL(request.url).hostname) ||
      !loopback.includes(new URL(`http://${host}`).hostname)
    )
      throw Error("This pilot only accepts local requests.");
    if (origin && new URL(origin).host !== host)
      throw Error("Cross-origin request denied.");
  }
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw Error("Cross-site request denied.");
}
export function failure(e: unknown) {
  return Response.json(
    { error: e instanceof Error ? e.message : "Request failed." },
    { status: 400 },
  );
}
/**
 * Run a route handler under database timing and return its response with a
 * Server-Timing header, so a slow page can be traced to connecting, round
 * trips or the app from the browser's network panel.
 */
export async function timed(handler: () => Promise<Response>) {
  const { result, timing, totalMs } = await withDatabaseTiming(handler);
  try {
    result.headers.set("Server-Timing", serverTiming(timing, totalMs));
  } catch {
    /* An immutable response keeps its own headers. */
  }
  return result;
}
