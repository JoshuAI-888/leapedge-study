import { readFileSync } from "node:fs";
import { db } from "../src/server/youtube-intelligence/store.ts";
if (process.env.YTI_ISOLATED_DB !== "true")
  throw Error("Use isolated local test database");
try {
  for (const id of [
    "d557f5b6-a0c6-46ff-a847-49a414094228",
    "4724a0cb-f419-4328-b331-258f0ccdf875",
    "1d84d28d-73b7-4822-ac1d-913c211c9125",
  ]) {
    const r = JSON.parse(
      readFileSync(`data/institutional-20260916/${id}.json`, "utf8"),
    ).run;
    await db()
      .prepare(
        "INSERT INTO yi_runs(id,video_id,url,model,prompt_version,title,status,stage,created_at,updated_at,input,output,cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING",
      )
      .run(
        r.id,
        r.videoId,
        r.url,
        r.model,
        r.promptVersion,
        r.title,
        r.status,
        r.stage,
        r.createdAt,
        r.updatedAt,
        JSON.stringify(r.input),
        JSON.stringify(r.output),
        r.cost,
      );
  }
  console.log(
    "Three retained runs imported into isolated fixture DB; no new analysis.",
  );
} finally {
  await db().close();
}
