-- Migration: 010_last_warning_at
-- Splits warning cooldown tracking from fail/recovery cooldown tracking.
-- last_notification_at remains exclusive to fail/recovery events.
-- last_warning_at tracks the most recent warning notification sent.
ALTER TABLE test_state ADD COLUMN last_warning_at TIMESTAMPTZ;
