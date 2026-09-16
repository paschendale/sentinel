-- public_status moves from "N consecutive failures" to a rolling time window (see
-- apps/api/src/db/public-status.ts): a test is only "down" once it has failed continuously
-- for longer than the window, and only "up" again once it has succeeded continuously for
-- longer than the window after trouble. These two timestamps track the start of whichever
-- streak is currently open; both null means the test is stably up (or has never run).
ALTER TABLE test_state
  ADD COLUMN failing_since TIMESTAMPTZ,
  ADD COLUMN succeeding_since TIMESTAMPTZ;
