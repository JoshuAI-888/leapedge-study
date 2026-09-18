-- Additive only: the indexes and constraints that replace the global
-- transaction lock. No type changes and no drops.

-- store.ts create(): one open run per (video, model, prompt version, input).
-- The dedupe key includes the input JSON, which carries prompt snapshots of up
-- to 30 KB and cannot be indexed, so the index keys on its md5 over canonical
-- text. Restricted to open rows, so a finished run never blocks a new one.
CREATE UNIQUE INDEX IF NOT EXISTS yi_runs_open_dedupe
  ON yi_runs(video_id, model, prompt_version, md5(input::text))
  WHERE status IN ('queued', 'running');

-- store.ts reserve(): one open attempt per (run, stage). A first reservation has
-- no row to lock, so this index is what rejects a second one.
CREATE UNIQUE INDEX IF NOT EXISTS yi_calls_open_attempt
  ON yi_calls(run_id, stage)
  WHERE status IN ('reserved', 'unknown');

-- transcripts.ts admission: one attempt row per (provider, mode, video_id,
-- lang). captionAttemptId() encodes exactly that tuple as yi_documents.id, so
-- the (kind, id) primary key from 0001 already is that unique constraint and
-- the first submission claims it with an insert-if-absent. Nothing to add.
