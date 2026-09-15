import { notFound } from "next/navigation";
import { readShare } from "../../../server/youtube-intelligence/briefings";
export const dynamic = "force-dynamic";
export default async function Share({
  params,
}: {
  params: Promise<{
    token: string;
  }>;
}) {
  const b = await readShare((await params).token);
  if (!b) notFound();
  return (
    <main>
      <div className="breadcrumb">YOUTUBE INTELLIGENCE / SHARED RESEARCH</div>
      <h1>Research digest</h1>
      <p>
        {b.date} · {b.timezone} · Frozen snapshot
      </p>
      {b.summaryPoints
        ?.filter((x) => x.passed)
        .map((x, i) => (
          <section className="panel research-panel" key={i}>
            <p>{x.text_en}</p>
          </section>
        ))}
      {b.groups.map((g) => (
        <section className="panel" key={g.ticker}>
          <h2>{g.ticker}</h2>
          <p>{g.agreement}</p>
          {g.calls.map((c) => (
            <article key={c.runId + c.claimId}>
              <h3>
                {c.channel} · {c.claim.stance}
              </h3>
              <p>{c.claim.thesis_en}</p>
              {c.claim.evidence.map((e, i) => (
                <blockquote key={i}>
                  {e.quote_original}
                  <p>{e.quote_translation_en}</p>
                </blockquote>
              ))}
            </article>
          ))}
        </section>
      ))}
      {b.limitations.map((x) => (
        <p key={x}>{x}</p>
      ))}
    </main>
  );
}
