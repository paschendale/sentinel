-- Migration: 012_email_channel
-- Adds 'email' as a notification channel type (via Resend).
-- webhook_url becomes nullable (email channels use email_to instead).

ALTER TABLE notification_channels ALTER COLUMN webhook_url DROP NOT NULL;

ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS email_to TEXT[];

ALTER TABLE notification_channels DROP CONSTRAINT IF EXISTS notification_channels_type_check;
ALTER TABLE notification_channels ADD CONSTRAINT notification_channels_type_check
  CHECK (type IN ('discord', 'slack', 'webhook', 'email'));
