/** Synthetic-only live adapter check. Never reads retained research. */
import { existsSync, writeFileSync } from "node:fs";
import { create, db } from "../src/server/youtube-intelligence/store.ts";
import { entityStep } from "../src/server/youtube-intelligence/entities.ts";
import { assertIsolatedDatabase } from "../src/server/youtube-intelligence/migrations/run.ts";
const path = "data/institutional-20260916/classification-synthetic.json";
assertIsolatedDatabase("smoke-entity-classification");
if (existsSync(path))
  throw Error("Result already exists; inspect it rather than resubmitting");
try {
  const r = await create(
    "synthetic__",
    "google/gemini-3.8-flash",
    {
      task: "entity-classification",
      entities: [
        {
          alias: "虛構電子公司",
          context:
            "An invented electronics company in a synthetic software test; no real issuer or security is intended.",
        },
      ],
    },
    "entity-classification.v1-synthetic",
  );
  try {
    await entityStep(r);
  } catch (e) {
    r.status = "failed";
    r.error = e instanceof Error ? e.message : "Unknown failure";
    throw e;
  } finally {
    await db()
      .prepare(
        "UPDATE yi_runs SET status=$1,stage=$2,output=$3,error=$4 WHERE id=$5",
      )
      .run(r.status, r.stage, JSON.stringify(r.output), r.error, r.id);
    writeFileSync(
      path,
      JSON.stringify(
        { status: r.status, output: r.output, error: r.error },
        null,
        2,
      ),
    );
  }
  console.log("Synthetic classification complete; inspect retained artifact.");
} finally {
  await db().close();
}
