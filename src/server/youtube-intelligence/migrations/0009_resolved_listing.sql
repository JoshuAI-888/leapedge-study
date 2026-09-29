-- The listed instrument a claim refers to, resolved by lookup when the creator
-- named a company without saying its ticker. `ticker` keeps what was said;
-- these columns are derived, outside the content digest human reviews bind to,
-- and may be recomputed. resolved_by records how: spoken_ticker, alias,
-- verified_proposal or registry_name.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS resolved_ticker text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS resolved_name text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS resolved_by text;
