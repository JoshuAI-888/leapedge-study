import { doc, put } from "../src/server/youtube-intelligence/research-store.ts";
import { sendPreview } from "../src/server/youtube-intelligence/email.ts";
import type { Briefing } from "../src/server/youtube-intelligence/briefings.ts";
// Explicit operator action: one delivery per frozen briefing and recipient.
const briefingId = process.argv[2];
if (!briefingId) throw Error("Pass a frozen briefing ID.");
const briefing = await doc<Briefing>("briefing", briefingId);
if (!briefing) throw Error("Briefing not found.");
const id = `email-smoke:${briefingId}`;
if (!(await doc("delivery", id)))
  await put("delivery", id, {
    id,
    date: briefing.date,
    briefingId,
    status: "preview_ready",
    createdAt: new Date().toISOString(),
    test: true,
  });
process.env.YTI_EMAIL_SEND_ENABLED = "true";
process.env.YTI_APP_ORIGIN ||= "http://127.0.0.1:3101";
const result = await sendPreview(id);
console.log(JSON.stringify(result));
