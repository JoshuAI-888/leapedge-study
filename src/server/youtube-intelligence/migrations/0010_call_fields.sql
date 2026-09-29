-- F60 richer call fields and F59 macro themes. Additive only (expand step).
-- levels: [{kind, valueOriginal, parsed}], where parsed is the application's
-- reading of valueOriginal (level-parse.ts) or null; the original wording is
-- always kept. catalysts_en / action_en / expiry_* / macro_theme are written
-- by prompt versions that ask for them; older claims keep the defaults.
-- mentions.instrument keeps the spoken name so macro and sector references,
-- which carry no ticker, can be grouped like tickers.
-- 0009 is reserved by another lane; the runner applies whichever is missing.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS levels jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS catalysts_en text[] NOT NULL DEFAULT '{}';
ALTER TABLE claims ADD COLUMN IF NOT EXISTS action_en text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS expiry_date date;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS expiry_original text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS macro_theme text;
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS instrument text;
CREATE INDEX IF NOT EXISTS claims_expiry ON claims(expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS claims_macro_theme ON claims(macro_theme) WHERE macro_theme IS NOT NULL;
