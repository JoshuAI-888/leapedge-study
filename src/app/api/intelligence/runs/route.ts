import { z } from "zod";
import {
  MODELS,
  Source,
  videoId,
} from "../../../../features/youtube-intelligence/contracts.ts";
import { create, list } from "../../../../server/youtube-intelligence/store.ts";
import {
  guard,
  failure,
} from "../../../../server/youtube-intelligence/http.ts";
import { queue } from "../../../../server/youtube-intelligence/research-store.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  try {
    guard(r);
    return Response.json({
      runs: (await list())
        .filter((r) => !r.input.task)
        .map((r) => ({
          ...r,
          input: {},
          output: {
            metadata: r.output.metadata,
            sourceHash: r.output.sourceHash,
            coverage: r.output.coverage,
            acceptedCount:
              r.status === "completed" && Array.isArray(r.output.claims)
                ? r.output.claims.filter((c) => c.passed).length
                : undefined,
            rejectedCount:
              r.status === "completed" && Array.isArray(r.output.claims)
                ? r.output.claims.filter((c) => !c.passed).length
                : undefined,
          },
        })),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    guard(r);
    const text = await r.text();
    if (text.length > 2000000)
      throw Error("Transcript exceeds the 2 MB import limit.");
    const body = z
      .object({
        url: z.string(),
        model: z.enum(MODELS),
        criticModel: z.enum(MODELS).optional(),
        promptVersion: z.string().optional(),
        source: Source.optional(),
      })
      .parse(JSON.parse(text));
    const id = videoId(body.url);
    if (body.source?.video_id && body.source.video_id !== id)
      throw Error("Transcript video ID does not match the URL.");
    return Response.json(
      {
        run: await queue(id, body.source, {
          model: body.model,
          ...(body.criticModel ? { criticModel: body.criticModel } : {}),
          ...(body.promptVersion ? { promptVersion: body.promptVersion } : {}),
        }),
      },
      { status: 201 },
    );
  } catch (e) {
    return failure(e);
  }
}
