# Domain model

The entities Sentinel stores, their fields and the rules that hold between them. Read this before adding or changing a table or a shared type. Tables are created by the plain SQL files in `apps/api/src/db/migrations/`; the TypeScript types and zod schemas are in `packages/shared/src/`.

Wire values are given in code font with the word people read beside them. The full glossary is in [Status and incidents](../guide/status-and-incidents.md). The `ctx` object test code receives is documented in [Writing tests](../guide/writing-tests.md).

## Entities

### Test

The central entity: a JavaScript check that Sentinel runs on a schedule. Table `tests`.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` (nanoid) | Unique identifier |
| `name` | `string` | Human-readable label, 1–255 characters |
| `code` | `string` | JavaScript function body that receives `ctx` |
| `schedule_ms` | `number` | Run interval in milliseconds (at least 30 000) |
| `timeout_ms` | `number` | Time limit per run (at least 1000, default 5000, at most 80% of `schedule_ms`) |
| `retries` | `number` | Extra attempts (0–5, default 0) for a scheduled run that fails or times out |
| `failure_threshold` | `number` | Consecutive failures before the test is in Outage and a channel is alerted (default 3) |
| `cooldown_ms` | `number` | Least time between two alerts of the same kind (default 86 400 000, 24 h) |
| `tags` | `string[]` | Free-form labels, up to 20. Drive filters, status pages, channel routing and incident groups (`incident:<group>`) |
| `enabled` | `boolean` | `false` is Paused: the scheduler does not run it |
| `uses_browser` | `boolean` | Kept for compatibility. Accepted and stored, does nothing; there are no browser tests |
| `created_at` | `timestamp` | Creation time |
| `updated_at` | `timestamp` | Last change |

**Invariants:**

- `schedule_ms >= 30000`.
- `timeout_ms >= 1000` and `timeout_ms <= schedule_ms * 0.8`, enforced by the zod schema and by a Postgres `CHECK` on create and update. The scheduler's overlap guard (`apps/api/src/scheduler/run-guard.ts`) backs it up: two scheduled runs of one test never overlap.
- `code` must compile (`new Function('ctx', code)`) on create and update; otherwise the request is a 400. Stored code that does not compile records a Failed run instead of running.
- A run fails when the code throws (a failed `ctx.assert` throws) or returns exactly `false`. Any other return value, or none, passes.
- Retries: one run is recorded, the last attempt's. A retry starts only if a full `timeout_ms` attempt still fits within 80% of `schedule_ms`, measured from the first attempt. Manual runs (run now, SSE, MCP `run_test_now`, bulk `run`) make one attempt.
- Deleting a test cascades to its runs, state, daily aggregates, threads and direct channel assignments. Incident links keep the test's name.

### TestRun

One execution of a test. Table `test_runs`, partitioned by month on `started_at`.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` (nanoid) | Unique identifier |
| `test_id` | `string` | FK → Test |
| `started_at` | `timestamp` | Start time (partition key) |
| `finished_at` | `timestamp` | End time |
| `status` | `'success' \| 'warn' \| 'fail' \| 'timeout'` | Run result: Passed, Warned, Failed, Timed out |
| `duration_ms` | `number` | Wall-clock duration |
| `error_message` | `string \| null` | Error or warning text when the result is not Passed |

**Invariants:**

- `finished_at >= started_at`.
- `warn` when the code called `ctx.warn()` and did not fail; `error_message` holds the warnings joined by `; `.
- `fail` with `error_message = 'returned false'` when the code returned exactly `false`.
- `timeout` when the run exceeded `timeout_ms`; `error_message` is `Timed out after <ms>ms`, followed by `; in flight: <call> (<elapsed>s, <progress>)` for every `ctx` call still pending. Those calls are aborted.
- When every attempt of a retried run fails, `error_message` ends with `[all <n> attempts failed]`. A run that passes on a retry records as `success`.
- `fail` and `timeout` are failures. `warn` is not: it resets the failure streak.
- Raw runs are kept `RAW_RETENTION_DAYS` (default 7) and pruned daily in batches. Runs are written in batches by the result buffer, never row by row.

### AssertionResult

One named assertion inside a run, recorded when code calls `ctx.assert()`. Table `assertion_results`.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` (nanoid) | Unique identifier |
| `test_run_id` | `string` | FK → TestRun |
| `test_run_started_at` | `timestamp` | Partition key companion for the FK |
| `name` | `string` | Assertion label, such as "status is 200" |
| `passed` | `boolean` | Whether it held |
| `message` | `string \| null` | Failure reason or context |

**Invariants:**

- `(test_run_id, test_run_started_at)` references `TestRun(id, started_at)` with `ON DELETE CASCADE`, so assertions are pruned with their runs.

### UptimeDaily

Daily counts per test. Table `uptime_daily`. The status page's 30-day history and uptime read this table.

| Field | Type | Description |
| --- | --- | --- |
| `test_id` | `string` | FK → Test |
| `date` | `date` | The UTC day |
| `success_count` | `number` | Passed runs |
| `warn_count` | `number` | Warned runs (migration 022; older rows have 0) |
| `failure_count` | `number` | Failed and Timed out runs. Warned runs are not counted here |
| `avg_latency_ms` | `number` | Average duration of the day's runs |

**Invariants:**

- One row per `(test_id, date)`, upserted by the daily aggregator.
- Uptime counts Passed and Warned runs as available and never reads 100% while a run failed (`uptimePct()` in `packages/shared/src/state.ts`).
- Kept `AGG_RETENTION_DAYS` (30–180, default 90).

### TestState

The live state of each test. Table `test_state`, one row per test, written by the same per-run upsert that records results.

| Field | Type | Description |
| --- | --- | --- |
| `test_id` | `string` | FK → Test (PK) |
| `last_status` | `'success' \| 'warn' \| 'fail' \| 'timeout' \| null` | Result of the most recent run |
| `consecutive_failures` | `number` | Unbroken streak of `fail` and `timeout` runs |
| `public_status` | `'up' \| 'degraded' \| 'down' \| 'unknown'` | State: Operational, Degraded, Outage, No data |
| `last_run_at` | `timestamp \| null` | When the test last ran; seeds the scheduler's first delay after a restart |
| `last_notification_at` | `timestamp \| null` | When the last Outage or Recovered alert was sent |
| `last_warning_at` | `timestamp \| null` | When the last Degraded alert was sent |
| `problem_started_at` | `timestamp \| null` | First run of the current or last streak of non-Operational state |
| `problem_ended_at` | `timestamp \| null` | First Operational run after that streak; null while it lasts |
| `problem_worst` | `'down' \| 'degraded' \| null` | Worst state in that streak |
| `last_problem_at` | `timestamp \| null` | Most recent run that did not pass |

**State rule** (`publicStatusFor()` in `packages/shared/src/state.ts`, mirrored in SQL in `apps/api/src/db/result-buffer.ts`): `up` on a Passed run; `down` on a failure once `consecutive_failures` reaches `failure_threshold`; `degraded` otherwise (a warning, or a failure under the threshold).

**Sections** (`statusSection()` in `packages/shared/src/sections.ts`): `disabled` (Paused) when the test is not enabled; else `critical` (Outage) when `down`; `warning` (Degraded) when `degraded`; `recovered` (Recovered) when `up` and `last_problem_at` is under 24 h old; otherwise `clean` (Operational). Tags take no part.

**Invariants:**

- `consecutive_failures` resets to 0 on `success` and `warn`.
- An Outage alert (`fail` event) is due when `consecutive_failures >= failure_threshold` and `cooldown_ms` has passed since `last_notification_at`.
- A Degraded alert (`warning` event) is due on a `warn` run once `cooldown_ms` has passed since `last_warning_at`. It is tracked separately, so a warning never holds back an Outage alert.
- A Recovered alert (`recovery` event) is due on a Passed run when an Outage or Degraded alert was sent; both timestamps are cleared on recovery.
- The problem window starts when a non-`up` state follows `up` or `unknown`, stays open through any mix of `degraded` and `down`, and ends on the first `up` run; `problem_worst` only rises within a window.

### Secret

A named value test code reads as `ctx.secrets.NAME`. Global: not tied to any test. Table `secrets`.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` (nanoid) | Unique identifier |
| `name` | `string` | `UPPER_SNAKE_CASE`; the literal `ctx.secrets` key |
| `value_blob` | `bytea` | Version-tagged blob: AES-256-GCM ciphertext when `SECRETS_ENCRYPTION_KEY` was set at write time, plaintext otherwise. Never exposed |
| `created_at` | `timestamp` | Creation time |
| `updated_at` | `timestamp` | Last rotation |

**Invariants:**

- `name` is unique and matches `^[A-Z][A-Z0-9_]*$` (zod and a `CHECK`).
- Write-only: no API response includes the value. Only create, rotate, delete, list and status (metadata) exist.
- `name` is immutable; changing a value means rotating it.
- Encrypted and plaintext secrets can coexist. Secrets written before a key was set stay plaintext until rotated.
- A secret the running process cannot decrypt is logged and left out of `ctx.secrets`; it never crashes the process.

### NotificationChannel

A named, global place alerts go. Table `notification_channels`. It receives nothing until it is assigned.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` (nanoid) | Unique identifier |
| `name` | `string` | Label, 1–100 characters |
| `type` | `'discord' \| 'slack' \| 'webhook' \| 'email' \| 'discord_bot' \| 'slack_bot'` | Webhook and email types post one message per event; bot types post one message per incident and keep a thread |
| `webhook_url` | `string \| null` | Required for `discord`, `slack`, `webhook` |
| `email_to` | `string[] \| null` | 1–10 recipients, required for `email` (sent through Resend) |
| `channel_ref` | `string \| null` | Slack channel ID (`C…`) or Discord channel ID, required for bot types |
| `bot_token_blob` | `bytea` | Bot token, stored with the secrets cipher. Never exposed; responses carry `has_bot_token` |
| `enabled` | `boolean` | Whether the channel is active |

**Invariants:**

- Per-type requirements are checked on create by the zod schema and on update against the merged row (`channelRequirementsError()`).
- The bot token is write-only: `PATCH` with `bot_token` replaces it, omitting it keeps it.
- `POST /channels/:id/test` sends a one-off message through any type, outside any incident.

See [Notifications](../guide/notifications.md).

### ChannelAssignment

Attaches a channel to a test or to a tag, for some event types. Table `channel_assignments`.

| Field | Type | Description |
| --- | --- | --- |
| `channel_id` | `string` | FK → NotificationChannel |
| `scope_type` | `'test' \| 'tag'` | Whether `scope_value` is a test id or a tag |
| `scope_value` | `string` | The test id or tag |
| `event_types` | `('fail' \| 'warning' \| 'recovery')[]` | Outage, Degraded, Recovered. Non-empty; default all three |

**Invariants:**

- Primary key `(channel_id, scope_type, scope_value)`.
- A channel fires for a test and event when any matching assignment (direct, or through one of the test's tags) includes that event type.
- A tag assignment is a loose reference to `Test.tags`, not a foreign key: it applies to every test that carries the tag, now or later.

### IncidentThread

An incident as tracked on one bot channel: the provider's root message and the thread under it. Table `notification_threads`.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` (nanoid) | Unique identifier |
| `test_id` | `string` | FK → Test (cascade) |
| `channel_id` | `string` | FK → NotificationChannel (cascade) |
| `incident_id` | `string \| null` | FK → Incident (set null on delete), when the thread belongs to a stored incident |
| `state` | `'down' \| 'degraded'` | What the root message says: Outage or Degraded |
| `provider_root_id` | `string` | Slack message `ts` or Discord message id of the root |
| `provider_thread_id` | `string` | Slack: the same `ts`; Discord: the thread channel id |
| `opened_at` | `timestamp` | When the root was posted; the duration shown on recovery runs from here |
| `closed_at` | `timestamp \| null` | Set on recovery; null while open |
| `last_update_at` | `timestamp` | Last reply; drives the heartbeat |
| `last_update_message` | `string \| null` | Dedupe key (`state\|error_message`) of the last reply |
| `update_count` | `number` | Replies posted |

**Invariants:**

- At most one open thread per `(test_id, channel_id)`.
- Opened only when the regular gating would alert. While open, every failing or warning evaluation feeds it, including the ones the gating skips; a reply is posted when the state or error changed, or after `INCIDENT_THREAD_HEARTBEAT_MS`.
- Closed on recovery whatever the assignment's `event_types`. A reconciler retries closes that failed.
- Closed threads are pruned after `NOTIFICATION_RETENTION_DAYS`; open ones never are.

### NotificationEvent

The notifier's audit log. Table `notification_events`.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique identifier |
| `test_id` | `string` | FK → Test (cascade) |
| `channel_id` | `string \| null` | FK → NotificationChannel (set null) |
| `incident_id` | `string \| null` | FK → Incident (set null) |
| `event` | `'fail' \| 'warning' \| 'recovery'` | Outage, Degraded, Recovered |
| `phase` | `string` | `sent`, `failed`, `skipped` and the like |
| `reason` | `string \| null` | Why (for example `no_channels`, `thread_opened`, `http_non_2xx`) |
| `consecutive_failures`, `failure_threshold`, `cooldown_ms` | `number` | The gating inputs at the time |
| `http_status` | `number \| null` | Provider response status |
| `error_message` | `string \| null` | Delivery error |
| `created_at` | `timestamp` | When it was logged |

**Invariants:**

- Only deliveries and due-but-undelivered alerts are logged, in batches; a failing run does not add rows by itself.
- Kept `NOTIFICATION_RETENTION_DAYS` (default 90).

### Incident

A stored outage with a timeline and a report. Table `incidents` (migration 021).

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` (nanoid) | Unique identifier |
| `title` | `string` | Default "<test name> outage" |
| `severity` | `'down' \| 'degraded'` | Worst state any linked test reached: Outage or Degraded |
| `state` | `'investigating' \| 'identified' \| 'monitoring' \| 'resolved'` | Investigating, Identified, Monitoring, Resolved |
| `started_at` | `timestamp` | Start of the first run that opened it |
| `resolved_at` | `timestamp \| null` | Null while open |
| `published_at` | `timestamp \| null` | Null is Internal; set when a person publishes it |
| `group_key` | `string \| null` | Value of the `incident:<group>` tag that opened it; null for a single-test incident |
| `duration_ms` | `number \| null` | Snapshot filled at resolve |
| `failed_runs` | `number \| null` | Snapshot filled at resolve |
| `created_at`, `updated_at` | `timestamp` | Bookkeeping |

**Invariants:**

- Opened, joined and resolved in the same transaction as the state upsert (`applyIncidentTransitions()` in `apps/api/src/db/queries/incidents.ts`):
  - a test entering `down` joins the open incident of its group, else opens one in `investigating`;
  - a test that is only `degraded` joins an open incident of its group but never opens one;
  - a linked test changing state writes a system update and may raise `severity`;
  - when no linked test is still in trouble, the incident is `resolved` and the snapshot is filled.
- At most one open incident per `group_key` is joined (the oldest).
- A reconciler ends links of Operational or paused tests and resolves incidents left without an affected test.
- Setting `resolved` by hand ends every link and fills the snapshot; leaving `resolved` reopens it and clears the snapshot.
- Publishing and unpublishing are for a person only; agent tokens get 403.

### IncidentTest

A test affected by an incident. Table `incident_tests`.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique identifier |
| `incident_id` | `string` | FK → Incident (cascade) |
| `test_id` | `string \| null` | FK → Test; set null when the test is deleted |
| `test_name` | `string` | Kept so the incident outlives the test |
| `started_at` | `timestamp` | When the test joined |
| `ended_at` | `timestamp \| null` | When it was Operational again; null while affected |
| `worst_status` | `'down' \| 'degraded'` | Worst state it reached in this incident |

**Invariants:**

- One link per `(incident_id, test_id)`. A link that ended is reopened if the test is in trouble again before the incident resolves.

### IncidentUpdate

One timeline entry. Table `incident_updates`.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique identifier |
| `incident_id` | `string` | FK → Incident (cascade) |
| `created_at` | `timestamp` | When it was written |
| `kind` | `'system' \| 'note'` | Written by Sentinel, or by a person or agent |
| `body` | `string` | The text |
| `author` | `string` | `user:<name>`, `token:<label>` or `system` |
| `public` | `boolean` | Shown on the status page once the incident is published (default false) |

**Invariants:**

- Agent tokens can add only internal notes; `public: true` is for a person.

### IncidentReport

The written account of an incident. Table `incident_reports`, at most one per incident.

| Field | Type | Description |
| --- | --- | --- |
| `incident_id` | `string` | PK, FK → Incident (cascade) |
| `summary_internal`, `summary_public` | `string` | Summary |
| `impact_internal`, `impact_public` | `string` | Impact |
| `root_cause_internal`, `root_cause_public` | `string` | Root cause |
| `resolution_internal`, `resolution_public` | `string` | Resolution |
| `follow_ups_internal`, `follow_ups_public` | `string` | Follow-ups |
| `published_at` | `timestamp \| null` | Null is a draft |
| `updated_at` | `timestamp` | Last save |

**Invariants:**

- Text is Markdown, rendered as a small subset (paragraphs, lists, links, inline code).
- Saving replaces only the sections and versions sent.
- Publishing needs some public text and a person; internal versions are never returned by public routes.

## Relationships

```
Test (1) ──→ (M) TestRun ──→ (M) AssertionResult
Test (1) ──→ (1) TestState
Test (1) ──→ (M) UptimeDaily
Test (1) ──→ (M) ChannelAssignment (scope_type = 'test')
Test (1) ──→ (M) IncidentThread
Test (1) ──→ (M) NotificationEvent
Test (1) ──→ (M) IncidentTest (test_id set null on delete)
NotificationChannel (1) ──→ (M) ChannelAssignment
NotificationChannel (1) ──→ (M) IncidentThread (bot types only)
Incident (1) ──→ (M) IncidentTest
Incident (1) ──→ (M) IncidentUpdate
Incident (1) ──→ (0..1) IncidentReport
Incident (1) ──→ (M) IncidentThread, NotificationEvent (incident_id, set null on delete)

ChannelAssignment.scope_value with scope_type = 'tag' matches Test.tags loosely,
not through a foreign key. Incident.group_key matches the value of a test's
incident:<group> tag the same way.

Secret is global and unrelated to other entities: every test can read every
secret through ctx.secrets.
```

## Outbound identification

Every `ctx.http`, `ctx.s3` and `ctx.k8s` request and every notifier webhook or email-API call sends `User-Agent: Sentinel (+https://github.com/territorial-dev/sentinel)`, or `Sentinel (+https://github.com/territorial-dev/sentinel; instance=<name>)` plus `X-Sentinel-Instance: <name>` when `SENTINEL_INSTANCE` is set. A `User-Agent` in the request's own headers wins. `ctx.ftp` has no equivalent.

## See also

- [Writing tests](../guide/writing-tests.md)
- [Notifications](../guide/notifications.md)
- [Status and incidents](../guide/status-and-incidents.md)
- [Deployment](../guide/deployment.md)
- [API reference](../reference/api.md)
- [Architecture](ARCHITECTURE.md)
- [Forking](../FORKING.md)
