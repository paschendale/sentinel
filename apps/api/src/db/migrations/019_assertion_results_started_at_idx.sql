-- Migration: 017_assertion_results_started_at_idx
-- The aggregator deletes a month's assertion_results before detaching and dropping that month's
-- test_runs partition (see 011's foreign key). This index lets it find them by date instead of
-- scanning the whole table on every batch.

CREATE INDEX IF NOT EXISTS assertion_results_test_run_started_at_idx
  ON assertion_results (test_run_started_at);
