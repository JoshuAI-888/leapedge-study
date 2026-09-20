CREATE TABLE yi_stage_timings (
 id text PRIMARY KEY, run_id text NOT NULL, job_id text NOT NULL, stage text NOT NULL,
 claimed_at timestamptz NOT NULL, finished_at timestamptz,
 queue_ms double precision NOT NULL CHECK(queue_ms>=0),
 execution_ms double precision, checkpoint_ms double precision,
 outcome text NOT NULL DEFAULT 'running'
);
CREATE INDEX yi_stage_timings_run ON yi_stage_timings(run_id,claimed_at);
CREATE TABLE yi_provider_slots (id text PRIMARY KEY,provider text NOT NULL,lease_until timestamptz NOT NULL);
CREATE INDEX yi_provider_slots_provider ON yi_provider_slots(provider,lease_until);
CREATE INDEX yi_runs_summary_page ON yi_runs(created_at DESC,id DESC) WHERE (input::jsonb)->>'task' IS NULL;
CREATE INDEX yi_runs_terminal_update ON yi_runs(updated_at DESC,id DESC) WHERE status NOT IN ('queued','running');
