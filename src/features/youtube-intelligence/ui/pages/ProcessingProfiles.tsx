import Link from "next/link";
import { PROCESSING_PROFILES } from "../../processing-profiles.ts";
import { PageTitle } from "../components.tsx";

export function ProcessingProfiles() {
  return (
    <>
      <PageTitle
        title="Processing profiles"
        description="Choose how new analyses use research work, while keeping evidence and required audits."
      />
      <section className="yi-panel">
        <h2>Start with Efficient</h2>
        <p>
          Efficient is the recommended profile for routine analysis. It reduces
          avoidable work without enabling provisional research in parallel.
          Research overlap is an experimental option for measured trials.
        </p>
        <p className="yi-muted">
          The choice is shared by this workspace and takes effect when you save
          team configuration in Settings. Already queued analyses and existing
          results retain their original configuration. A profile does not change
          your selected models, processing capacity or budget limits.
        </p>
        <Link href="/youtube-intelligence/settings">Back to Settings</Link>
      </section>
      {PROCESSING_PROFILES.map((profile) => (
        <section className="yi-panel" key={profile.value} id={profile.value}>
          <h2>{profile.label}</h2>
          <p>{profile.description}</p>
          <ul>
            {profile.details.map(detail => <li key={detail}>{detail}</li>)}
          </ul>
        </section>
      ))}
      <section className="yi-panel">
        <h2>Safeguards in every profile</h2>
        <p>
          Original transcript evidence, timestamps and references remain
          available for inspection. Independent checks still govern accepted
          claims and research publication. Video-date analysis and current
          updates retain their separate time boundaries. No profile grants a
          human-verified badge or turns an unverified statement into a fact.
        </p>
        <p>
          Unnecessary English translation is skipped in every profile. After a
          fatal account error, untouched chunks stop before making requests and
          started calls drain with their responses retained for audit and replay.
        </p>
        <h2>How to compare results</h2>
        <p>
          Compare the same sources and settings, then review total time,
          component timings, settled costs and any uncertain charges alongside
          coverage, factual support and exact citations. A faster result is
          useful only when the important information and its supporting evidence
          remain intact. Cache eligibility and provider variability mean savings
          can differ between analyses.
        </p>
        <Link href="/youtube-intelligence/settings">Choose a profile in Settings</Link>
      </section>
    </>
  );
}
