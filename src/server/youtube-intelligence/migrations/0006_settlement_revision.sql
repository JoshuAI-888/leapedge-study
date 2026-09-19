-- A monotonic revision resolves same-timestamp corrections deterministically.
ALTER TABLE settlements ADD COLUMN revision bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX settlements_revision ON settlements(revision);
