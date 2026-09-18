-- F25: prices and settlements (spec 4.11, 4.12, 8).
--
-- Two tables and one rule. The rule is that a settlement row records what the
-- call's own instrument did, and nothing else: no benchmark, no excess return.
-- Excess is the call's return minus the benchmark's over the same days, and the
-- benchmark is the viewer's choice (spec 4.12), so storing it would freeze one
-- reader's setting into everybody's history. Changing the benchmark must change
-- nothing stored, which is only true if nothing about a benchmark is stored.

-- Adjusted closes, one row per ticker and session. Benchmarks are rows here
-- too: SPY, QQQ, a sector ETF and a custom ticker are all just tickers, which
-- is what lets the benchmark be chosen at query time.
--
-- source and fetched_at are not bookkeeping. Spec 4.11 allows external prices
-- precisely because each bar carries where it came from and when it was taken,
-- so any figure computed from it can be reproduced or found to have moved.
CREATE TABLE IF NOT EXISTS prices(
  ticker text NOT NULL,
  date date NOT NULL,
  adjusted_close double precision NOT NULL CHECK (adjusted_close > 0),
  source text NOT NULL,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (ticker, date)
);
CREATE INDEX IF NOT EXISTS prices_ticker_date ON prices(ticker, date);

-- One row per claim, horizon and sweep. Append-only and dated, so the board
-- "as of" any date is the same computation with a cut-off and no snapshot is
-- ever stored (spec 4.12, Changes tab).
--
-- status: settled | pending | not-settleable. A call in a market with no price
-- source is a row saying so, not an absence: spec 4.12 requires it to be listed
-- with the label rather than hidden, and the next sweep settles it if a source
-- appears. return_pct is null for every status but settled.
--
-- record keeps the forward record and the historical replay apart. They are
-- never mixed, and the record selector names which one is being shown.
CREATE TABLE IF NOT EXISTS settlements(
  id text PRIMARY KEY,
  claim_id text NOT NULL,
  horizon_days integer NOT NULL,
  entry_date date,
  entry_price double precision,
  exit_date date,
  exit_price double precision,
  return_pct double precision,
  status text NOT NULL,
  reason text,
  record text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlements_status CHECK (status IN ('settled','pending','not-settleable')),
  CONSTRAINT settlements_record CHECK (record IN ('forward','historical')),
  CONSTRAINT settlements_settled_is_priced CHECK (
    status <> 'settled' OR (
      entry_date IS NOT NULL AND entry_price IS NOT NULL AND
      exit_date IS NOT NULL AND exit_price IS NOT NULL AND
      return_pct IS NOT NULL AND exit_date >= entry_date
    )
  )
);
CREATE INDEX IF NOT EXISTS settlements_claim ON settlements(claim_id, created_at);
CREATE INDEX IF NOT EXISTS settlements_record ON settlements(record, horizon_days, created_at);

-- Append-only, enforced here rather than by convention.
--
-- settlements and reviews are the two tables a later figure is reconstructed
-- from: a leaderboard as of a past date reads the rows that existed then, and a
-- trust level at L3 is exactly the claim that somebody signed a review. An
-- UPDATE to either silently rewrites history that has already been reported,
-- and no application-level care makes that impossible from a psql prompt.
-- A correction is a new row, which is why there is no exception.
CREATE OR REPLACE FUNCTION yi_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'append-only table %: a correction is a new row, never an edit to an old one',
    TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS settlements_append_only ON settlements;
CREATE TRIGGER settlements_append_only
  BEFORE UPDATE OR DELETE ON settlements
  FOR EACH ROW EXECUTE FUNCTION yi_append_only();

DROP TRIGGER IF EXISTS reviews_append_only ON reviews;
CREATE TRIGGER reviews_append_only
  BEFORE UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION yi_append_only();
