import { z } from "zod";
import {
  guard,
  failure,
} from "../../../../server/youtube-intelligence/http.ts";
import * as R from "../../../../server/youtube-intelligence/research-store.ts";
import {
  follow,
  pull,
  updateChannel,
  analyzeDiscovery,
} from "../../../../server/youtube-intelligence/channels.ts";
import {
  buildBriefing,
  shareBriefing,
  revokeShare,
  shareSelection,
} from "../../../../server/youtube-intelligence/briefings.ts";
import { queueBriefing } from "../../../../server/youtube-intelligence/briefing-pipeline.ts";
import { queueAudioReview } from "../../../../server/youtube-intelligence/audio-review.ts";
import { startExperiment } from "../../../../server/youtube-intelligence/experiments.ts";
import { performance } from "../../../../server/youtube-intelligence/market.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  try {
    guard(r);
    if (new URL(r.url).searchParams.get("view") === "preferences")
      return Response.json({ preferences: await R.preferences() });
    return Response.json({
      ...(await R.researchSnapshot()),
      performances: await R.docs("performance"),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    guard(r);
    const text = await r.text();
    if (text.length > 150000) throw Error("Request too large.");
    const a = z
      .object({ action: z.string(), data: z.unknown() })
      .parse(JSON.parse(text));
    let result: unknown;
    switch (a.action) {
      case "audioReview":
        result = await queueAudioReview(z.string().parse(a.data));
        break;
      case "experiment":
        result = await startExperiment(a.data);
        break;
      case "shareSelection":
        result = await shareSelection(a.data);
        break;
      case "recoverAudit":
        result = await R.continueAfterAuditFailure(z.string().parse(a.data));
        break;
      case "publishRun":
        result = await R.publishRun(z.string().parse(a.data));
        break;
      case "preferences":
        result = await R.savePreferences(a.data);
        break;
      case "prompt":
        result = await R.addPrompt(a.data);
        break;
      case "follow":
        result = await follow(z.string().max(500).parse(a.data));
        break;
      case "channel":
        result = await updateChannel(a.data);
        break;
      case "pull":
        result = await pull(z.string().parse(a.data));
        break;
      case "pullOlder":
        result = await pull(z.string().parse(a.data), true);
        break;
      case "analyzeUpload":
        result = await analyzeDiscovery(z.string().parse(a.data));
        break;
      case "saveIdea": {
        const v = z
          .object({ runId: z.string(), claimId: z.string() })
          .parse(a.data);
        result = await R.saveIdea(v.runId, v.claimId);
        break;
      }
      case "idea":
        result = await R.changeIdea(a.data);
        break;
      case "watch":
        result = await R.watch(a.data);
        break;
      case "comparison":
        result = await R.comparison(a.data);
        break;
      case "review":
        result = await R.review(a.data);
        break;
      case "improvement":
        result = await R.improvement(a.data);
        break;
      case "synthesizeBriefing":
        result = await queueBriefing(z.string().parse(a.data));
        break;
      case "briefing":
        result = await buildBriefing(
          z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .parse(a.data || undefined),
        );
        break;
      case "share":
        result = await shareBriefing(z.string().parse(a.data));
        break;
      case "revoke":
        result = await revokeShare(z.string().parse(a.data));
        break;
      case "performance":
        result = await performance(
          z.enum(["leapedge", "forward", "historical"]).parse(a.data),
        );
        break;
      default:
        throw Error("Unknown research action.");
    }
    return Response.json({ result });
  } catch (e) {
    return failure(e);
  }
}
