import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NYSE_HOLIDAYS,
  assignmentReason,
  holidayName,
  isTradingDay,
  isValidTimeZone,
  localTime,
  marketStatus,
  nextSession,
  previousSession,
  sessionFor,
  sessionLabel,
  sessionsBetween,
  timeZoneOptions,
} from "../src/features/youtube-intelligence/trading-day.ts";
import {
  AccountPreferences,
  TeamPreferences,
  migrateLegacyPreferences,
  resolveAccount,
  teamDefaults,
} from "../src/features/youtube-intelligence/settings.ts";

test("A publish before or during Monday's session belongs to Monday", () => {
  // 08:00 and 10:00 EDT on Monday 28 September 2026.
  assert.deepEqual(sessionFor("2026-09-28T12:00:00Z"), {
    session: "2026-09-28",
    reason: "pre-market",
    holiday: null,
  });
  assert.equal(sessionFor("2026-09-28T14:00:00Z").reason, "in-session");
  assert.equal(sessionFor("2026-09-28T14:00:00Z").session, "2026-09-28");
  // Midnight ET is still before Monday's close.
  assert.equal(sessionFor("2026-09-28T04:00:00Z").session, "2026-09-28");
});

test("A publish after Monday's 16:00 ET close belongs to Tuesday", () => {
  const s = sessionFor("2026-09-28T21:00:00Z");
  assert.equal(s.session, "2026-09-29");
  assert.equal(s.reason, "after-close");
});

test("16:00:00 exactly is after the close; one millisecond earlier is not", () => {
  assert.equal(sessionFor("2026-09-29T19:59:59.999Z").session, "2026-09-29");
  assert.equal(sessionFor("2026-09-29T20:00:00Z").session, "2026-09-30");
  assert.equal(sessionFor("2026-09-29T20:00:00Z").reason, "after-close");
});

test("Friday after the close and the weekend roll into Monday", () => {
  assert.equal(sessionFor("2026-09-25T20:30:00Z").session, "2026-09-28");
  assert.equal(sessionFor("2026-09-25T20:30:00Z").reason, "after-close");
  // Saturday noon ET.
  const saturday = sessionFor("2026-09-26T16:00:00Z");
  assert.equal(saturday.session, "2026-09-28");
  assert.equal(saturday.reason, "weekend");
  // Sunday late evening ET.
  assert.equal(sessionFor("2026-09-28T03:59:00Z").reason, "weekend");
});

test("New Zealand offsets are read as instants, not as New York wall times", () => {
  // Tue 29 Sep 08:30 NZDT is Mon 28 Sep 15:30 EDT: still Monday's session.
  assert.equal(sessionFor("2026-09-29T08:30:00+13:00").session, "2026-09-28");
  // An hour later it is after Monday's close.
  assert.equal(sessionFor("2026-09-29T09:30:00+13:00").session, "2026-09-29");
  // Sat 26 Sep 14:00 NZST is Fri 25 Sep 22:00 EDT: after Friday's close.
  assert.equal(sessionFor("2026-09-26T14:00:00+12:00").session, "2026-09-28");
  // Date objects and epoch milliseconds are accepted too.
  assert.equal(
    sessionFor(new Date("2026-09-28T14:00:00Z")).session,
    "2026-09-28",
  );
  assert.equal(
    sessionFor(Date.parse("2026-09-28T14:00:00Z")).session,
    "2026-09-28",
  );
});

test("US daylight saving boundaries in March and November 2026 move the close", () => {
  // Sessions before 8 March close at 21:00Z (EST); after it at 20:00Z (EDT).
  assert.equal(sessionFor("2026-03-06T20:30:00Z").session, "2026-03-06");
  assert.equal(sessionFor("2026-03-06T21:00:00Z").session, "2026-03-09");
  assert.equal(sessionFor("2026-03-09T19:59:59Z").session, "2026-03-09");
  assert.equal(sessionFor("2026-03-09T20:00:00Z").session, "2026-03-10");
  // 13:45Z is 09:45 EDT after the change (in session), not 08:45 EST.
  assert.equal(sessionFor("2026-03-09T13:45:00Z").reason, "in-session");
  // Back to EST on 1 November.
  assert.equal(sessionFor("2026-10-30T20:30:00Z").session, "2026-11-02");
  assert.equal(sessionFor("2026-11-02T20:30:00Z").session, "2026-11-02");
  assert.equal(sessionFor("2026-11-02T21:00:00Z").session, "2026-11-03");
});

test("Thanksgiving 2026 rolls to Friday, and the half day after it is a session", () => {
  assert.equal(isTradingDay("2026-11-26"), false);
  assert.equal(holidayName("2026-11-26"), "Thanksgiving Day");
  const thanksgiving = sessionFor("2026-11-26T15:00:00Z");
  assert.deepEqual(thanksgiving, {
    session: "2026-11-27",
    reason: "holiday",
    holiday: "Thanksgiving Day",
  });
  assert.equal(isTradingDay("2026-11-27"), true);
  assert.equal(sessionFor("2026-11-27T17:00:00Z").session, "2026-11-27");
  // Wednesday after the close skips the holiday.
  assert.equal(sessionFor("2026-11-25T22:00:00Z").session, "2026-11-27");
});

test("The holiday table covers 2025 to 2027 with observed dates on weekdays", () => {
  const dates = Object.keys(NYSE_HOLIDAYS);
  for (const year of ["2025", "2026", "2027"])
    assert.ok(
      dates.filter((d) => d.startsWith(year)).length >= 10,
      `${year} is missing holidays`,
    );
  for (const date of dates) {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    assert.ok(day >= 1 && day <= 5, `${date} is not a weekday`);
    assert.equal(isTradingDay(date), false);
  }
  // Observed dates: Independence Day 2026 falls on a Saturday, 2027 on a Sunday.
  assert.equal(holidayName("2026-07-03"), "Independence Day (observed)");
  assert.equal(holidayName("2027-07-05"), "Independence Day (observed)");
  assert.equal(holidayName("2027-12-24"), "Christmas Day (observed)");
  assert.equal(holidayName("2026-04-03"), "Good Friday");
  assert.equal(holidayName("2027-06-18"), "Juneteenth (observed)");
  // New Year 2028 falls on a Saturday and NYSE does not close the Friday before.
  assert.equal(isTradingDay("2027-12-31"), true);
  assert.equal(holidayName("2026-09-28"), null);
});

test("Previous and next sessions skip weekends and holidays", () => {
  assert.equal(previousSession("2026-09-28"), "2026-09-25");
  assert.equal(nextSession("2026-09-25"), "2026-09-28");
  assert.equal(nextSession("2026-07-02"), "2026-07-06");
  assert.equal(previousSession("2026-11-27"), "2026-11-25");
  assert.equal(nextSession("2026-12-24"), "2026-12-28");
  // A non-trading day still has neighbours.
  assert.equal(previousSession("2026-09-27"), "2026-09-25");
  assert.equal(nextSession("2026-09-26"), "2026-09-28");
  assert.equal(isTradingDay("2026-09-26"), false);
  assert.throws(() => nextSession("28/09/2026"), RangeError);
});

test("sessionsBetween lists trading days inclusively and is empty when reversed", () => {
  assert.deepEqual(sessionsBetween("2026-11-24", "2026-11-30"), [
    "2026-11-24",
    "2026-11-25",
    "2026-11-27",
    "2026-11-30",
  ]);
  assert.deepEqual(sessionsBetween("2026-09-26", "2026-09-27"), []);
  assert.deepEqual(sessionsBetween("2026-09-30", "2026-09-28"), []);
  assert.deepEqual(sessionsBetween("2026-09-28", "2026-09-28"), [
    "2026-09-28",
  ]);
});

test("Session labels read like a person wrote them", () => {
  assert.equal(sessionLabel("2026-09-28"), "Mon 28 Sep · US session");
  assert.equal(sessionLabel("2026-11-27"), "Fri 27 Nov · US session");
  assert.equal(
    sessionLabel("2026-09-28", { year: true }),
    "Mon 28 Sep 2026 · US session",
  );
});

test("The hover explains the local publish time and the assignment", () => {
  assert.equal(
    localTime("2026-09-26T02:00:00Z", "Pacific/Auckland"),
    "Sat 26 Sep 14:00 NZST",
  );
  assert.equal(
    assignmentReason("2026-09-26T21:00:00Z", "Pacific/Auckland"),
    "Published Sun 27 Sep 10:00 NZDT → Mon 28 Sep session (weekend)",
  );
  assert.equal(
    assignmentReason("2026-09-26T02:00:00Z", "Pacific/Auckland"),
    "Published Sat 26 Sep 14:00 NZST → Mon 28 Sep session (after Fri 25 Sep close)",
  );
  assert.equal(
    assignmentReason("2026-11-26T15:00:00Z", "America/New_York"),
    "Published Thu 26 Nov 10:00 EST → Fri 27 Nov session (Thanksgiving Day)",
  );
  assert.equal(
    assignmentReason("2026-09-28T14:00:00Z", "UTC"),
    "Published Mon 28 Sep 14:00 UTC → Mon 28 Sep session (during the session)",
  );
  assert.match(
    assignmentReason("2026-09-28T12:00:00Z", "Europe/London"),
    /→ Mon 28 Sep session \(before the open\)$/,
  );
});

test("Market status says what state the US market is in and how long until it changes", () => {
  const pre = marketStatus("2026-09-28T11:20:00Z");
  assert.equal(pre.state, "pre-market");
  assert.equal(pre.minutesToChange, 130);
  assert.equal(pre.label, "US market: pre-market · opens in 2 h 10 m");
  const open = marketStatus("2026-09-28T14:00:00Z");
  assert.equal(open.state, "open");
  assert.equal(open.label, "US market: open · closes in 6 h 0 m");
  const after = marketStatus("2026-09-28T22:00:00Z");
  assert.equal(after.state, "after-hours");
  assert.equal(after.minutesToChange, 15 * 60 + 30);
  const weekend = marketStatus("2026-09-26T16:00:00Z");
  assert.equal(weekend.state, "closed");
  assert.equal(weekend.session, "2026-09-28");
  assert.equal(
    weekend.label,
    "US market: closed · opens Mon 28 Sep in 1 d 21 h 30 m",
  );
  const holiday = marketStatus("2026-11-26T15:00:00Z");
  assert.equal(holiday.state, "closed");
  assert.equal(holiday.session, "2026-11-27");
  assert.equal(holiday.holiday, "Thanksgiving Day");
  // Overnight before a trading day, before 04:00 ET.
  assert.equal(marketStatus("2026-09-29T06:00:00Z").state, "closed");
  assert.equal(marketStatus("2026-09-29T06:00:00Z").minutesToChange, 450);
});

test("Invalid instants and time zones are refused rather than guessed", () => {
  assert.throws(() => sessionFor("not a date"), RangeError);
  assert.equal(isValidTimeZone("Pacific/Auckland"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Mars/Olympus_Mons"), false);
  assert.equal(isValidTimeZone(""), false);
  const options = timeZoneOptions();
  assert.ok(options.includes("Pacific/Auckland"));
  assert.ok(options.includes("America/New_York"));
  assert.ok(options.includes("UTC"));
});

test("The team display time zone defaults to Auckland and is validated", () => {
  assert.equal(teamDefaults().display.timezone, "Pacific/Auckland");
  assert.equal(
    TeamPreferences.parse({ display: { timezone: "America/New_York" } })
      .display.timezone,
    "America/New_York",
  );
  assert.equal(
    TeamPreferences.safeParse({ display: { timezone: "Mars/Olympus_Mons" } })
      .success,
    false,
  );
  // A stored document written before the setting existed still parses.
  const stored = JSON.parse(JSON.stringify(teamDefaults()));
  delete stored.display;
  assert.equal(TeamPreferences.parse(stored).display.timezone, "Pacific/Auckland");
});

test("The digest time zone follows the team unless an account set its own", () => {
  const team = TeamPreferences.parse({
    display: { timezone: "America/New_York" },
  });
  const inherited = resolveAccount(team, AccountPreferences.parse({}));
  assert.equal(inherited.digest.timezone, "America/New_York");
  // A document saved before the merge carries an explicit zone and keeps it.
  const explicit = AccountPreferences.parse({
    digest: { timezone: "Europe/London" },
  });
  assert.equal(resolveAccount(team, explicit).digest.timezone, "Europe/London");
  assert.equal(AccountPreferences.parse({}).digest.timezone, null);
  assert.equal(
    AccountPreferences.safeParse({ digest: { timezone: "Nowhere/Here" } })
      .success,
    false,
  );
  // The legacy flat document's zone was the team's zone.
  const migrated = migrateLegacyPreferences({ timezone: "Asia/Shanghai" });
  assert.equal(migrated.team.display.timezone, "Asia/Shanghai");
  assert.equal(
    resolveAccount(migrated.team, migrated.account).digest.timezone,
    "Asia/Shanghai",
  );
});
