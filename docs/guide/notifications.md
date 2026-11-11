# Notifications

Sentinel alerts channels when a test changes state. A channel is a named delivery target; it receives nothing until it is assigned to a test or a tag. Channels are managed on the Notifications page (`/admin/notifications`), through the `/channels` routes or with the MCP channel tools (see the [API reference](../reference/api.md)).

What the states mean, and how incidents open and resolve: [Status and incidents](./status-and-incidents.md).

## Events

| Event (UI) | Wire value | Sent when |
| --- | --- | --- |
| Outage | `fail` | The test reaches Outage: Failed or Timed out runs in a row reach its `failure_threshold` (and, with a [status window](status-and-incidents.md#the-status-window), it has been failing for the whole window), outside the cooldown |
| Degraded | `warning` | A run is Warned (`ctx.warn`), outside the warning cooldown. No threshold |
| Recovered | `recovery` | The test is Operational again (with a status window, after passing for the whole window) and an Outage or Degraded alert was sent |

Rules:

- Alerts follow state changes. A test that stays in Outage does not alert again until `cooldown_ms` (default `86400000`, 24 h) has passed since the last Outage alert.
- Outage and Degraded have separate cooldowns (`last_notification_at` and `last_warning_at`), so a Degraded alert never holds back an Outage alert.
- Failures under the threshold make the test Degraded on the dashboard but do not send a Degraded alert; only `ctx.warn` does.
- Recovered goes out only when an Outage or Degraded alert was sent before; it clears both cooldowns and carries how long the problem lasted.
- Alerts are fire-and-forget: they never delay a test run. All channels for an event are delivered in parallel, and each request gives up after 10 s, so one hung endpoint does not hold up the others.

## Channel types

| Type | Delivers | Needs |
| --- | --- | --- |
| `discord` | One message per event, as a Discord embed | `webhook_url` |
| `slack` | One message per event, as a Slack attachment | `webhook_url` |
| `webhook` | One JSON body per event (below) | `webhook_url` |
| `email` | One email per event, sent through Resend | `email_to` (1 to 10 addresses); the server needs `RESEND_API_KEY` and `RESEND_FROM` |
| `discord_bot` | One message per incident, updates in a thread | `bot_token`, `channel_ref` (channel ID) |
| `slack_bot` | One message per incident, updates in a thread | `bot_token`, `channel_ref` (channel ID, `C…`) |

`webhook_url` must be a valid URL. Bot tokens are write-only: they are stored with the secrets cipher (encrypted when `SECRETS_ENCRYPTION_KEY` is set, plaintext otherwise) and never returned; responses carry `has_bot_token`. Sending a new `bot_token` on update replaces it; leaving it out keeps it.

Notification requests send the same `User-Agent` and `X-Sentinel-Instance` headers as test requests (see [Writing tests](./writing-tests.md#outbound-identification)).

## Assigning channels

A channel is assigned to a test (direct) or to a tag (every test with that tag inherits it). Each assignment carries the event types it fires on: Outage, Degraded and Recovered, all three by default, at least one. So one test can send Degraded alerts to a quiet channel and Outage alerts to a paging one without being split in two.

A channel fires for a test and an event when any matching assignment, direct or through one of the test's tags, includes that event. The test page (`/admin/tests/:id`) shows the effective routing: every channel that fires for the test, its events, and where it comes from (direct or the tag). The same list is `GET /tests/:id/channels/effective`.

With MCP: `assign_channel` (with `scope_type` `test` or `tag` and optional `event_types`) and `unassign_channel`.

## Checking a channel

"Send test message" on the Notifications page, `POST /channels/:id/test` or the MCP tool `test_channel` sends one message through any channel type, outside any incident, and returns the HTTP status. The message is titled "Sentinel channel test". A webhook channel receives `{ "event": "test", "message": "…", "timestamp": "…" }`.

## What the messages say

Titles put the state first: `Outage: <test name>`, `Degraded: <test name>`, `Recovered: <test name>`. Fields:

| Event | Fields |
| --- | --- |
| Outage | Reason (the run's error message), Consecutive failures, Response time |
| Degraded | Reason (the warnings), Response time |
| Recovered | Lasted (time since the first alert), Response time |

Discord and Slack messages are coloured with the state colours (outage red, degraded amber, operational green). Emails carry the same title and fields. Messages contain no emoji.

### Webhook body

The generic `webhook` type receives:

```json
{
  "test_id": "V1StGXR8_Z5jdHi6B-myT",
  "test_name": "API health",
  "event": "fail",
  "consecutive_failures": 3,
  "error_message": "status is 200: assertion failed",
  "duration_ms": 412,
  "downtime_ms": null,
  "timestamp": "2026-11-10T18:43:00.000Z"
}
```

`event` is `fail`, `warning` or `recovery` (`test` for a channel test). `downtime_ms` is set on recovery. These field names and values are stable.

## Bot channels: one message per incident

`discord_bot` and `slack_bot` post through a bot token, which lets Sentinel edit what it posted:

- When a test first alerts (Outage past the threshold, or Degraded), the bot posts a root message and opens a thread under it.
- Everything that happens while it lasts goes into the thread: the error message changing, the test moving between Outage and Degraded, and a "Still in outage for 2 h" reply every `INCIDENT_THREAD_HEARTBEAT_MS` (default 1 h) while nothing changes. The channel itself keeps one line per incident.
- On recovery the root is edited to "Recovered: <test name>" with how long it lasted, a closing reply is posted ("Recovered after 2 h 27 min · response 120 ms"), and the thread is archived (Discord) or the root gets a check-mark reaction (Slack).

An open thread is always closed where it was opened, even if the assignment does not include Recovered. Failures under the threshold and inside the cooldown still feed an open thread; they never open a new one. If closing fails (a provider error, a restart mid-delivery), the reconciler retries every 5 min for threads whose test has been Operational for at least 2 min.

Threads belong to the test's stored incident: `notification_threads.incident_id` links them, so the thread and the incident page tell the same story. See [Status and incidents](./status-and-incidents.md).

### Slack bot setup

1. Create a Slack app and add the bot token scope `chat:write` (and `reactions:write` for the recovery reaction).
2. Install it to the workspace and invite the bot to the channel (`/invite @your-bot`).
3. Use the Bot User OAuth Token (`xoxb-…`) as `bot_token` and the channel ID (`C…`, at the bottom of the channel details) as `channel_ref`.

### Discord bot setup

1. Create an application at discord.com/developers, add a bot and copy its token.
2. Invite it with the `bot` scope and the permissions View Channels, Send Messages, Create Public Threads, Send Messages in Threads and Embed Links.
3. Enable Developer Mode, right-click the channel, Copy Channel ID, and use it as `channel_ref`.

## Audit log

Each delivery, and each alert that was due but not delivered, is written to `notification_events` (kept `NOTIFICATION_RETENTION_DAYS`, default 90). Closed threads are pruned with the same retention; open threads are kept.
