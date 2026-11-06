-- Migration: 019_bot_channels_incident_threads
-- Adds two bot-backed channel types ('slack_bot', 'discord_bot') that post through a bot
-- token instead of a webhook, so Sentinel can edit the message it posted and keep the
-- history of an incident inside a thread. Also records one open incident thread per
-- test per channel, and removes channel assignments left behind by deleted tests.

ALTER TABLE notification_channels DROP CONSTRAINT IF EXISTS notification_channels_type_check;
ALTER TABLE notification_channels ADD CONSTRAINT notification_channels_type_check
  CHECK (type IN ('discord', 'slack', 'webhook', 'email', 'discord_bot', 'slack_bot'));

-- Bot token, stored with the same version-tagged cipher as secrets (see
-- apps/api/src/crypto/secret-cipher.ts). Never returned by any API response.
ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS bot_token_blob BYTEA;
-- The Slack channel ID (C…) or Discord channel ID the bot posts into.
ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS channel_ref TEXT;

-- One row per incident per bot channel: the provider's root message and thread handles,
-- so later events edit the root and reply in the thread instead of posting again.
CREATE TABLE notification_threads (
  id                  TEXT        PRIMARY KEY,
  test_id             TEXT        NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  channel_id          TEXT        NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  state               TEXT        NOT NULL CHECK (state IN ('down', 'degraded')),
  provider_root_id    TEXT        NOT NULL,
  provider_thread_id  TEXT        NOT NULL,
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at           TIMESTAMPTZ,
  last_update_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_update_message TEXT,
  update_count        INTEGER     NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX notification_threads_open_idx
  ON notification_threads (test_id, channel_id) WHERE closed_at IS NULL;

CREATE INDEX notification_threads_closed_idx
  ON notification_threads (closed_at) WHERE closed_at IS NOT NULL;

-- Assignments whose test no longer exists (DELETE /tests/:id did not remove them).
DELETE FROM channel_assignments ca
 WHERE ca.scope_type = 'test'
   AND NOT EXISTS (SELECT 1 FROM tests t WHERE t.id = ca.scope_value);
