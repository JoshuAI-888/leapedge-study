import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const origin = process.env.YTI_APP_ORIGIN!;
assert.equal(origin, "https://youtube-intelligence-two.vercel.app");
const login = await fetch(origin + "/api/access", {
  method: "POST",
  headers: {
    Origin: origin,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({ code: process.env.YTI_ACCESS_TOKEN! }),
  redirect: "manual",
});
assert.equal(login.status, 303);
const r = await fetch(origin + "/api/intelligence/research", {
  headers: { Cookie: login.headers.get("set-cookie")!.split(";")[0] },
});
assert.equal(r.status, 200);
const data = await r.json();
assert.equal(data.preferences.promptVersion, "evidence-first.web.v5");
assert.equal(data.preferences.nativeGoogleExperimental, false);
const deliveries = data.deliveries.filter((d: any) =>
  d.id.startsWith("completion-event-"),
);
assert.ok(deliveries.some((d: any) => d.status === "delivered"));
assert.ok(deliveries.some((d: any) => d.status === "bounced"));
const report = {
  at: new Date().toISOString(),
  origin,
  authenticatedRead: "passed",
  promptVersion: data.preferences.promptVersion,
  nativeGoogleExperimental: data.preferences.nativeGoogleExperimental,
  deliveryStatuses: deliveries.map((d: any) => ({
    id: d.id,
    status: d.status,
    lastEvent: d.lastEvent,
  })),
  findingsVisible: data.captionBenchmarks.some(
    (b: any) => b.id === "completion-campaign-20260915",
  ),
};
writeFileSync(
  "docs/completion-final-hosted-status-20260915.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
