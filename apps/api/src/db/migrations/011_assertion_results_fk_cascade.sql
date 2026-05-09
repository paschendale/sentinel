-- Migration: 011_assertion_results_fk_cascade
-- Enforces FK integrity for assertion_results against partitioned test_runs with ON DELETE CASCADE.

ALTER TABLE assertion_results
  ADD COLUMN IF NOT EXISTS test_run_started_at TIMESTAMPTZ;

UPDATE assertion_results ar
SET test_run_started_at = tr.started_at
FROM test_runs tr
WHERE ar.test_run_started_at IS NULL
  AND tr.id = ar.test_run_id;

DELETE FROM assertion_results
WHERE test_run_started_at IS NULL;

ALTER TABLE assertion_results
  ALTER COLUMN test_run_started_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'assertion_results_test_run_fk'
  ) THEN
    ALTER TABLE assertion_results
      ADD CONSTRAINT assertion_results_test_run_fk
      FOREIGN KEY (test_run_id, test_run_started_at)
      REFERENCES test_runs (id, started_at)
      ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS assertion_results_test_run_fk_idx
  ON assertion_results (test_run_id, test_run_started_at);

DROP INDEX IF EXISTS assertion_results_test_run_id_idx;
