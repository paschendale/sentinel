-- Migration: 016_channel_assignment_event_types
-- Lets each channel_assignments row fire on only a subset of notification
-- event types (fail/warning/recovery) instead of all three unconditionally,
-- so a single test can route warnings and failures to different channels.

ALTER TABLE channel_assignments
  ADD COLUMN event_types TEXT[] NOT NULL DEFAULT ARRAY['fail', 'warning', 'recovery'];

ALTER TABLE channel_assignments
  ADD CONSTRAINT channel_assignments_event_types_check
  CHECK (
    event_types <@ ARRAY['fail', 'warning', 'recovery']::TEXT[]
    AND cardinality(event_types) > 0
  );
