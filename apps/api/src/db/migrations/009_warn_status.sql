-- Migration: 009_warn_status
-- Adds 'warn' as a first-class test run status (degraded / yellow state).

ALTER TABLE test_runs DROP CONSTRAINT test_runs_status_check;
ALTER TABLE test_runs ADD CONSTRAINT test_runs_status_check
  CHECK (status IN ('success', 'warn', 'fail', 'timeout'));

ALTER TABLE test_state DROP CONSTRAINT test_state_last_status_check;
ALTER TABLE test_state ADD CONSTRAINT test_state_last_status_check
  CHECK (last_status IN ('success', 'warn', 'fail', 'timeout'));

ALTER TABLE notification_events DROP CONSTRAINT notification_events_event_check;
ALTER TABLE notification_events ADD CONSTRAINT notification_events_event_check
  CHECK (event IN ('fail', 'recovery', 'warning'));
