# Database fixtures

Each JSON file here is a `FixtureSpec` (schema in `tests/helpers/fixtures.ts`)
that `seedFixture(name)` writes into the current test database through the
ordinary `store.ts` and `research-store.ts` APIs: channels and generic
documents via `put`, runs into `yi_runs` with their claims in `output.claims`,
discoveries linking each video to its channel, price series as `prices`
documents (same ids `market.ts` uses), and one `settlement` document per
claim computed with `scoreCall` from the seeded prices.

All ids derive from SHA-256 of the fixture `id` and each row's `key`, so the
same file always produces the same ids and rows. Timestamps come from the file,
not the clock. Nothing here is product data; see spec section 4.11.

- `baseline.json`: 2 channels (one English, one Chinese), 3 completed runs,
  6 claims with tickers and stances, daily NVDA and SPY closes for June to
  September 2026, a watchlist entry.
