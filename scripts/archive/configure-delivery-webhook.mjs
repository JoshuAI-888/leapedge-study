// Run only with the newly created, task-scoped Resend webhook visible in Chrome.
// Capture its UI-displayed secret directly into local/Vercel configuration; never log it.
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
const apple = (code) =>
  execFileSync(
    "osascript",
    [
      "-e",
      `tell application "Google Chrome" to execute active tab of front window javascript ${JSON.stringify(code)}`,
    ],
    { encoding: "utf8" },
  ).trim();
const url = execFileSync(
  "osascript",
  [
    "-e",
    'tell application "Google Chrome" to get URL of active tab of front window',
  ],
  { encoding: "utf8" },
).trim();
if (!/^https:\/\/resend.com\/webhooks\/[\w-]+$/.test(url))
  throw Error("Open the new webhook details first");
const endpoint =
  "https://youtube-intelligence-two.vercel.app/api/email/webhook";
if (
  apple(
    "document.body.innerText.includes(" + JSON.stringify(endpoint) + ")",
  ) !== "true"
)
  throw Error("Wrong webhook");
const secret = apple(
  'document.body.innerText.match(/whsec_[A-Za-z0-9+/=]+/)?.[0] || ""',
);
if (!/^whsec_[A-Za-z0-9+/=]{20,}$/.test(secret))
  throw Error("Signing secret not visible");
apple("document.querySelector('button[aria-label=\"Hide value\"]')?.click()");
let local = fs
  .readFileSync(".env.local", "utf8")
  .replace(/^RESEND_WEBHOOK_SECRET=.*\n?/gm, "");
fs.writeFileSync(
  ".env.local",
  local.trimEnd() + "\nRESEND_WEBHOOK_SECRET=" + JSON.stringify(secret) + "\n",
  { mode: 0o600 },
);
const auth = JSON.parse(
  fs.readFileSync(
    os.homedir() + "/Library/Application Support/com.vercel.cli/auth.json",
  ),
);
const { projectId, orgId } = JSON.parse(
  fs.readFileSync(".vercel/project.json"),
);
if (projectId !== "prj_P9ttQtxfV8dwMJAZC9coKgAChoqR")
  throw Error("Wrong project");
const r = await fetch(
  `https://api.vercel.com/v10/projects/${projectId}/env?teamId=${orgId}&upsert=true`,
  {
    method: "POST",
    headers: {
      Authorization: "Bearer " + auth.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key: "RESEND_WEBHOOK_SECRET",
      value: secret,
      type: "encrypted",
      target: ["production", "preview"],
    }),
  },
);
if (!r.ok) throw Error("Secret configuration HTTP " + r.status);
const report = {
  at: new Date().toISOString(),
  webhookUrl: url,
  endpoint,
  events: [
    "email.delivered",
    "email.bounced",
    "email.complained",
    "email.delivery_delayed",
    "email.failed",
  ],
  localSecretConfigured: true,
  vercelSecretConfigured: true,
  redeploymentRequired: true,
};
fs.writeFileSync(
  "docs/completion-webhook-setup-20260915.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
