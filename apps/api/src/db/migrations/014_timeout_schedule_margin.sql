-- Migration: 014_timeout_schedule_margin
-- Removes the flat 10s timeout_ms cap and replaces it with a relative constraint:
-- timeout_ms must leave enough margin below schedule_ms so the scheduler can never
-- have two overlapping runs of the same test in flight (see apps/api/src/scheduler/index.ts).
-- Kept as integer arithmetic (timeout_ms * 5 <= schedule_ms * 4) to avoid float rounding.

ALTER TABLE tests DROP CONSTRAINT tests_timeout_ms_check;

ALTER TABLE tests ADD CONSTRAINT tests_timeout_schedule_margin_check
  CHECK (timeout_ms * 5 <= schedule_ms * 4);
