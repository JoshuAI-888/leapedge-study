/** Synthetic browser acceptance data. Never points at a production database. */
import { fixtureSpec, seedFixture } from "../tests/helpers/fixtures.ts";
import { database } from "../src/server/youtube-intelligence/database.ts";
import { list } from "../src/server/youtube-intelligence/store.ts";
import {
  rowsForRun,
  writeRunRows,
} from "../src/server/youtube-intelligence/repos/publish.ts";
import { savePrices } from "../src/server/youtube-intelligence/repos/prices.ts";
import { upsertChannel } from "../src/server/youtube-intelligence/repos/channels.ts";
import {
  deriveEvidence,
  type CheckedClaim,
  type SourceData,
} from "../src/features/youtube-intelligence/contracts.ts";

const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid/invalid");
if (
  process.env.YTI_ISOLATED_DB !== "true" ||
  process.env.YTI_FIXTURE_MODE !== "true" ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/yti_browser"
)
  throw Error(
    "Browser fixtures require local yti_browser, YTI_ISOLATED_DB=true and YTI_FIXTURE_MODE=true.",
  );
try {
  if ((await list()).length)
    throw Error(
      "Browser database is already seeded; refusing to overwrite user changes.",
    );
  const spec = fixtureSpec("baseline");
  // Fixture channels cannot trigger paid background work.
  for (const channel of spec.channels) channel.autoAnalyze = false;
  await seedFixture(spec);
  for (const channel of spec.channels)
    await upsertChannel({
      ...channel,
      active: true,
      id: channel.id,
      tier: "1",
      discovery: "manual",
      processing: "on-request",
      followedAt: channel.createdAt,
    });
  for (const run of await list()) {
    const source = run.output.source as SourceData;
    for (const checked of run.output.claims as CheckedClaim[]) {
      checked.claim.evidence = checked.claim.evidence.map((e) => {
        const span = {
          start_id: e.segment_id,
          end_id: e.end_segment_id ?? e.segment_id,
        };
        const derived = deriveEvidence(source, span);
        return {
          ...e,
          quote_original: derived.quote_original,
          source_span: {
            ...span,
            start_seconds: derived.start_seconds,
            end_seconds: derived.end_seconds,
            text_hash: derived.text_hash,
          },
        };
      });
    }
    run.input.record = "forward";
    await database
      .prepare("UPDATE yi_runs SET input=$1,output=$2 WHERE id=$3")
      .run(JSON.stringify(run.input), JSON.stringify(run.output), run.id);
    await writeRunRows(rowsForRun(run));
  }
  await savePrices(
    spec.prices.flatMap((p) =>
      p.closes.map(([date, adjustedClose]) => ({
        ticker: p.symbol,
        date,
        adjustedClose,
        source: "SYNTHETIC browser fixture",
        fetchedAt: p.fetchedAt,
      })),
    ),
  );
  console.log(
    "Seeded synthetic browser fixtures: 2 channels, completed runs, relational claims/evidence and price history. No provider calls.",
  );
} finally {
  await database.close();
}
