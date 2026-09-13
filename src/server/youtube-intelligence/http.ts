import { requestSession } from "./access.ts";
const loopback = ["localhost", "127.0.0.1", "[::1]"];
export function guard(request: Request) {
  const origin = request.headers.get("origin"),
    host = request.headers.get("host") || new URL(request.url).host;
  if (process.env.YTI_APP_ORIGIN) {
    const app = new URL(process.env.YTI_APP_ORIGIN);
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
