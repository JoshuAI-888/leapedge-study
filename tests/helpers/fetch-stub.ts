/**
 * Test helper: replace globalThis.fetch with a route-matched responder.
 *
 *   const stub = stubFetch([
 *     { method: "POST", url: "/v1/transcript", respond: () => json({ jobId: "j" }, 202) },
 *     { url: /\/v1\/transcript\/[\w-]+$/, respond: () => json({ status: "completed" }) },
 *     { url: "googleapis.com", responses: [() => json(page1), () => json(page2)] },
 *   ]);
 *   try { ... assert.equal(stub.calls("googleapis.com").length, 2); }
 *   finally { stub.restore(); }
 *
 * Rules
 * - Routes are tried in order; the first whose method and URL match answers.
 *   `url` is a substring of the full URL or a RegExp tested against it;
 *   `method` (case-insensitive) defaults to any method.
 * - `respond` is a Response factory (it may be async and may throw, which
 *   rejects the fetch like a network error) or a static Response, which is
 *   cloned per call so its body can be read every time.
 * - `responses` is a queue for the same route: each call shifts one factory;
 *   an exhausted queue throws, so an unexpected extra call fails the test.
 * - A call no route matches throws `unmatched fetch: METHOD URL` instead of
 *   reaching the network. It is still logged (route: null).
 * - `log` records every call in order: url, method, body (string or null),
 *   headers and the index of the route that answered.
 * - `restore()` puts back whatever fetch was installed when stubFetch ran, so
 *   stubs nest and unwind in LIFO order.
 */
export type RecordedCall = {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
  route: number | null;
};
export type Responder = (call: RecordedCall) => Response | Promise<Response>;
export type Route = {
  method?: string;
  url: string | RegExp;
  respond?: Responder | Response;
  responses?: (Responder | Response)[];
};
export type FetchStub = {
  log: RecordedCall[];
  calls(url?: string | RegExp): RecordedCall[];
  restore(): void;
};
export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
function matches(pattern: string | RegExp, url: string) {
  return typeof pattern === "string" ? url.includes(pattern) : pattern.test(url);
}
async function answer(source: Responder | Response, call: RecordedCall) {
  return source instanceof Response ? source.clone() : await source(call);
}
async function bodyText(input: RequestInfo | URL, init?: RequestInit) {
  const body = init?.body;
  if (body === undefined || body === null) {
    if (input instanceof Request && input.body) return await input.clone().text();
    return null;
  }
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body))
    return Buffer.from(body instanceof ArrayBuffer ? body : body.buffer).toString("utf8");
  return await new Response(body as BodyInit).text();
}
export function stubFetch(routes: Route[]): FetchStub {
  for (const [i, r] of routes.entries())
    if ((r.respond === undefined) === (r.responses === undefined))
      throw Error(`fetch stub route ${i} needs exactly one of respond or responses`);
  const previous = globalThis.fetch;
  const log: RecordedCall[] = [];
  const queues = routes.map((r) => (r.responses ? [...r.responses] : null));
  const stubbed: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (
      init?.method ??
      (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    ).forEach((v, k) => (headers[k] = v));
    const call: RecordedCall = {
      url,
      method,
      body: await bodyText(input, init),
      headers,
      route: null,
    };
    log.push(call);
    const index = routes.findIndex(
      (r) =>
        (!r.method || r.method.toUpperCase() === method) && matches(r.url, url),
    );
    if (index < 0) throw Error(`unmatched fetch: ${method} ${url}`);
    call.route = index;
    const route = routes[index],
      queue = queues[index];
    if (queue) {
      const next = queue.shift();
      if (!next)
        throw Error(
          `fetch stub: queue exhausted for route ${index} (${String(route.url)}) on call ${log.length}`,
        );
      return answer(next, call);
    }
    return answer(route.respond!, call);
  };
  globalThis.fetch = stubbed;
  return {
    log,
    calls: (url) => (url ? log.filter((c) => matches(url, c.url)) : [...log]),
    restore: () => {
      globalThis.fetch = previous;
    },
  };
}
