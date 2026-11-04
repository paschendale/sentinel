-- Migration: 018_notification_events_created_at_idx
-- The aggregator deletes notification_events older than NOTIFICATION_RETENTION_DAYS in batches; this index
-- lets each batch find them by date instead of scanning the table.

CREATE INDEX IF NOT EXISTS idx_notification_events_created
  ON notification_events (created_at);
