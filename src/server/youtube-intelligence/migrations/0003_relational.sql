-- The relational core (spec 8). New tables only: no existing column changes
-- type or is dropped here, so the bundle in flight keeps reading and writing
-- yi_documents exactly as before while rows are filled beside it. The type
-- changes on the old tables are a separate, drain-and-pause migration.
--
-- No foreign key points at a baseline table. A database stamped at version 1
-- (one that predates the runner) never ran 0001, so yi_documents and friends
-- may be absent while this file runs. The keys between the new tables are left
-- out for the same reason the document migration is resumable: a half-written
-- run must not fail on a claim its mention refers to.

-- Followed creators. The first nine columns are the spec's; the rest is the
-- polling state channels.ts keeps on each channel today and the Channels
-- surface reads, which has to live somewhere once the document is gone.
CREATE TABLE IF NOT EXISTS channels(
  id text PRIMARY KEY,
  handle text,
  title text,
  tier text,
  seed_source text[] NOT NULL DEFAULT '{}',
  discovery text,
  processing text,
  auto_analyze boolean NOT NULL DEFAULT false,
  followed_at timestamptz,
  uploads text,
  active boolean NOT NULL DEFAULT true,
  favorite boolean NOT NULL DEFAULT false,
  last_pull timestamptz,
  last_attempt timestamptz,
  next_pull_at timestamptz,
  next_page_token text,
  history_started boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One accepted, actionable call. id is <run id>:<claim id within the run>, so
-- publishing the same run twice writes the same row rather than a second one.
CREATE TABLE IF NOT EXISTS claims(
  id text PRIMARY KEY,
  run_id text NOT NULL,
  video_id text NOT NULL,
  channel_id text,
  instrument text,
  ticker text,
  ticker_explicit boolean NOT NULL DEFAULT false,
  stance text NOT NULL,
  thesis_en text NOT NULL,
  horizon_en text,
  conditions_en text[] NOT NULL DEFAULT '{}',
  risks_en text[] NOT NULL DEFAULT '{}',
  creator_conviction text NOT NULL DEFAULT 'unspecified',
  trust_level text NOT NULL DEFAULT 'L0'
    CHECK (trust_level IN ('L0', 'L1', 'L2', 'L3')),
  trust_basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_hash text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claims_run ON claims(run_id);
CREATE INDEX IF NOT EXISTS claims_ticker ON claims(ticker, published_at);
CREATE INDEX IF NOT EXISTS claims_channel ON claims(channel_id, published_at);

-- Every stance-tagged reference, whether or not it is also a call. `sentiment`
-- is not in the spec's column list but is required by 4.13: the sentiment
-- shift counts mentions by it, and a mention carries one in the contract.
CREATE TABLE IF NOT EXISTS mentions(
  id text PRIMARY KEY,
  run_id text NOT NULL,
  video_id text NOT NULL,
  channel_id text,
  ticker text,
  stance text NOT NULL,
  sentiment text NOT NULL
    CHECK (sentiment IN ('bullish', 'neutral', 'bearish')),
  is_call boolean NOT NULL DEFAULT false,
  claim_id text,
  trust_level text NOT NULL DEFAULT 'L0'
    CHECK (trust_level IN ('L0', 'L1', 'L2', 'L3')),
  span_id text,
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS mentions_run ON mentions(run_id);
CREATE INDEX IF NOT EXISTS mentions_ticker ON mentions(ticker, published_at);
CREATE INDEX IF NOT EXISTS mentions_channel ON mentions(channel_id, published_at);

-- The copied source ranges behind one claim, in the order the claim cites
-- them. `ordinal` is not in the spec's column list and is what makes the row
-- addressable: two evidence entries may name the same range.
CREATE TABLE IF NOT EXISTS evidence_spans(
  claim_id text NOT NULL,
  ordinal integer NOT NULL,
  start_id text NOT NULL,
  end_id text NOT NULL,
  start_seconds double precision,
  end_seconds double precision,
  text_original text NOT NULL,
  text_hash text,
  translation_en text,
  agreement_score double precision,
  anchor_error_seconds double precision,
  tie_break_source text,
  PRIMARY KEY (claim_id, ordinal)
);

-- Immutable. A row is written once and never updated: a second transcript of
-- the same video is another row with its own kind, provider and hash.
CREATE TABLE IF NOT EXISTS transcripts(
  id text PRIMARY KEY,
  video_id text NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('caption', 'asr-window', 'whisper', 'merged')),
  provider text,
  language text,
  hash text,
  segments jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transcripts_video ON transcripts(video_id, kind, created_at);

-- Append-only human verification. Nothing writes here yet: signing an L3
-- needs the account identity that arrives with 4.18.
CREATE TABLE IF NOT EXISTS reviews(
  id text PRIMARY KEY,
  claim_id text NOT NULL,
  reviewer_account_id text NOT NULL,
  verdict text NOT NULL,
  note text,
  listened_span jsonb,
  signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_claim ON reviews(claim_id, signed_at);

-- A resolved, tradeable symbol.
CREATE TABLE IF NOT EXISTS instruments(
  symbol text PRIMARY KEY,
  name text,
  currency text,
  exchange text,
  market text,
  verified_at timestamptz
);

-- The work queue. The table is created here so the relational core arrives in
-- one migration; the claim, lease and retry semantics belong to the queue item
-- and nothing writes a row until it lands.
CREATE TABLE IF NOT EXISTS jobs(
  id text PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token text,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status, run_after, created_at);
