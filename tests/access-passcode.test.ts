import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/access/route.ts";

const origin = "https://yti.example";
const signing = "s".repeat(40);
function login(code: string) {
  return POST(
    new Request(`${origin}/api/access`, {
      method: "POST",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code }).toString(),
    }),
  );
}
function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const prior = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  Object.assign(process.env, values);
  for (const [k, v] of Object.entries(values)) if (v === undefined) delete process.env[k];
  return run().finally(() => {
    for (const [k, v] of Object.entries(prior))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });
}

test("the shared passcode signs in while the strong key stays the signing secret", () =>
  withEnv({ YTI_APP_ORIGIN: origin, YTI_ACCESS_TOKEN: signing, YTI_PASSCODE: "shared-code", VERCEL_ENV: undefined }, async () => {
    const ok = await login("shared-code");
    assert.equal(ok.status, 303);
    assert.match(ok.headers.get("set-cookie") || "", /^yti_session=\d+\.[a-f0-9]{64};/);
    assert.equal((await login(signing)).status, 401);
    assert.equal((await login("wrong")).status, 401);
  }));

test("without a passcode the signing key remains the code", () =>
  withEnv({ YTI_APP_ORIGIN: origin, YTI_ACCESS_TOKEN: signing, YTI_PASSCODE: undefined, VERCEL_ENV: undefined }, async () => {
    assert.equal((await login(signing)).status, 303);
  }));
