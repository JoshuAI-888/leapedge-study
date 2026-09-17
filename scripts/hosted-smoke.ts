import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const reservation = createServer();
await new Promise<void>((resolve) =>
  reservation.listen(0, "127.0.0.1", resolve),
);
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const rawFetch = globalThis.fetch;
const fetch = (url: string, init: RequestInit = {}) =>
  rawFetch(url, { ...init, signal: AbortSignal.timeout(5000) });
const origin = `http://127.0.0.1:${port}`,
  code = randomBytes(32).toString("hex"),
  directory = mkdtempSync(join(tmpdir(), "yti-hosted-"));
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    env: {
      ...process.env,
      YTI_APP_ORIGIN: origin,
      YTI_ACCESS_TOKEN: code,
      YTI_DB_PATH: join(directory, "test.sqlite"),
      YTI_PUBLIC_SHARES: "false",
    },
    stdio: "ignore",
  },
);
try {
  let ready = false;
  for (let i = 0; i < 20; i++) {
    if (server.exitCode !== null)
      throw Error("Production test server exited before readiness");
    try {
      if ((await fetch(origin + "/access")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, "Production server becomes ready");
  assert.equal(
    (await fetch(origin + "/api/intelligence/research")).status,
    401,
  );
  assert.equal(
    (await fetch(origin + "/research", { redirect: "manual" })).status,
    307,
  );
  assert.equal(
    (
      await fetch(origin + "/api/access", {
        method: "POST",
        headers: { origin: "https://evil.test" },
        body: new URLSearchParams({ code }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(origin + "/api/access", {
        method: "POST",
        headers: { origin },
        body: new URLSearchParams({ code: "wrong" }),
      })
    ).status,
    401,
  );
  const login = await fetch(origin + "/api/access", {
    method: "POST",
    headers: { origin },
    body: new URLSearchParams({ code }),
    redirect: "manual",
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const data = await fetch(origin + "/api/intelligence/research", {
    headers: { cookie },
  });
  assert.equal(data.status, 200);
  assert.ok((await data.json()).preferences);
  assert.equal(
    (await fetch(origin + "/share/invalid", { headers: { cookie } })).status,
    404,
  );
  const result = {
    at: new Date().toISOString(),
    unauthenticatedApi: "401",
    privatePage: "redirect to access",
    wrongOrigin: "403",
    wrongCode: "401",
    signedSession: "accepted",
    publicSharesDisabled: "404",
    status: "passed",
    externalServicesCalled: false,
  };
  writeFileSync(
    "docs/hosted-access-check.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  server.kill("SIGTERM");
}
