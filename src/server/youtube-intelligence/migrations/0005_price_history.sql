-- Historical boards read the price revision known at their cutoff.
CREATE TABLE IF NOT EXISTS price_history(
  ticker text NOT NULL,
  date date NOT NULL,
  adjusted_close double precision NOT NULL CHECK (adjusted_close > 0),
  source text NOT NULL,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY(ticker,date,fetched_at)
);
INSERT INTO price_history(ticker,date,adjusted_close,source,fetched_at)
SELECT ticker,date,adjusted_close,source,fetched_at FROM prices
ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS price_history_cutoff ON price_history(ticker,fetched_at,date);
CREATE TRIGGER price_history_append_only
  BEFORE UPDATE OR DELETE ON price_history
  FOR EACH ROW EXECUTE FUNCTION yi_append_only();
