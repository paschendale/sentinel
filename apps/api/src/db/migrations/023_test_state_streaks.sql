-- Start of the current failure streak and of the current passing streak, for the optional
-- status window (STATUS_WINDOW_MINUTES). Maintained by the per-run upsert in result-buffer.ts:
--
--   failing_since     first run of the current run of failures (fail/timeout); NULL otherwise
--   succeeding_since  first run of the current run of passes; NULL otherwise
--
-- IF NOT EXISTS: forks that already track these columns under the same names keep their data.
ALTER TABLE test_state ADD COLUMN IF NOT EXISTS failing_since TIMESTAMPTZ;
ALTER TABLE test_state ADD COLUMN IF NOT EXISTS succeeding_since TIMESTAMPTZ;
