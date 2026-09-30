"use client";
import { useEffect, useState } from "react";
import {
  DEFAULT_TIME_ZONE,
  assignmentReason,
  marketStatus,
  sessionFor,
  sessionLabel,
  type Instant,
} from "../trading-day.ts";
import { useWorkspace } from "./workspace.tsx";

/**
 * The trading-day label (F58): "Mon 28 Sep · US session". The hover gives the
 * publish time on the team's clock and why it was assigned to that session.
 * An unreadable instant renders as "Date unknown" rather than a guess.
 */
export function TradingDayLabel({
  at,
  timeZone,
  year = false,
}: {
  at: Instant | null | undefined;
  timeZone: string;
  year?: boolean;
}) {
  let label = "Date unknown",
    reason = "No publish time is recorded.",
    session: string | undefined;
  try {
    if (at !== null && at !== undefined && at !== "") {
      session = sessionFor(at).session;
      label = sessionLabel(session, { year });
      reason = assignmentReason(at, timeZone);
    }
  } catch {
    session = undefined;
  }
  return (
    <time
      className="yi-trading-day"
      dateTime={session}
      title={reason}
      aria-label={`${label}. ${reason}`}
      tabIndex={0}
    >
      {label}
    </time>
  );
}

/** The team display zone from Settings, falling back to the product default. */
export function useTeamTimeZone(): string {
  const { data } = useWorkspace();
  return data?.preferences.team.display?.timezone ?? DEFAULT_TIME_ZONE;
}

/** TradingDayLabel on the team's clock. Must be inside the workspace provider. */
export function TradingDay({
  at,
  year,
}: {
  at: Instant | null | undefined;
  year?: boolean;
}) {
  return <TradingDayLabel at={at} timeZone={useTeamTimeZone()} year={year} />;
}

/**
 * "US market: pre-market · opens in 2 h 10 m". Rendered only after mount and
 * refreshed each minute, so the server render never disagrees with the clock.
 */
export function MarketStatusLine() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) return null;
  const status = marketStatus(now);
  return (
    <p className={`yi-market-status yi-market-${status.state}`}>
      {status.label}
    </p>
  );
}
