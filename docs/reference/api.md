# API reference

Every REST route of the Sentinel API, how to authenticate, and the MCP server. The API is a single Fastify process; in the full Docker image it is served under `/api` behind Caddy, and on its own on port 3001.

Words and wire values (`up`, `degraded`, `down`; `success`, `warn`, `fail`, `timeout`; section keys) are explained in [Status and incidents](../guide/status-and-incidents.md). Test code is in [Writing tests](../guide/writing-tests.md).

## Authentication

Every route needs `Authorization: Bearer <token>` except these public ones:

- `POST /auth/login`
- `GET /status` and everything under it
- `GET /metrics`
- `GET /health`

There are two kinds of token, both HMAC-signed JWTs:

| Token | Issued by | Claim | Default expiry | Can publish |
| --- | --- | --- | --- | --- |
| Login | `POST /auth/login` | `sub: "admin"` | 24 h | Yes |
| API (agent) | `POST /auth/mcp-token` | `sub: "mcp"`, optional `label` | 1 year (8760 h), at most 10 years (87 600 h) | No |

A token without `sub: "mcp"` counts as a person. API tokens can do everything else, including reading and writing incidents, but publishing an incident, a public note or a report returns 403 to them. Notes and other changes record their author as `user:<ADMIN_USERNAME>` or `token:<label>`.

There is no per-token revocation: rotating `JWT_SECRET` invalidates every token and session at once. Tokens are not stored; one that is lost cannot be shown again.

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "yourpassword"}'
# → { "token": "eyJ..." }

curl -H "Authorization: Bearer <token>" http://localhost:3001/tests
```

The web app signs in at `/admin` and keeps the login token in a cookie.

## Errors

Every error response has one shape:

```json
{ "error": "timeout_ms must be at most 80% of schedule_ms", "details": { } }
```

`error` is always a string. `details` is present on validation errors (the zod breakdown) and a few other cases. Common statuses: 400 invalid input, 401 missing or bad token, 403 a token tried to publish, 404 not found, 409 conflict, 422 the test is paused (run now), 502 a channel test delivery failed.

## Auth

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | `{ username, password }` | `{ token }`; 401 on bad credentials |
| `POST` | `/auth/mcp-token` | `{ expires_in_hours?: 1–87600, label?: string }` | `{ token, expires_at }`. `label` is 1–50 letters, digits, spaces, `.`, `_` or `-` |

## Tests

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/tests` | All tests. `?tag=` filters by tag |
| `POST` | `/tests` | Create. Code that does not compile is a 400 (`code does not compile: …`); `timeout_ms` over 80% of `schedule_ms` is a 400. Returns 201 with the test |
| `GET` | `/tests/:id` | One test, with its code |
| `PATCH` | `/tests/:id` | Partial update; same checks as create. 400 when no fields are given |
| `DELETE` | `/tests/:id` | Deletes the test, its runs and its own channel assignments. 204 |
| `GET` | `/tests/export` | `{ tests: [...] }`, every test without `id`, `created_at`, `updated_at` |
| `POST` | `/tests/import` | `{ tests: [...] }` in the export format. All or nothing: any invalid entry is a 400 with per-index errors in `details`. Returns 201 `{ created, tests }` |
| `POST` | `/tests/bulk` | One action on many tests; see below |
| `GET` | `/tests/:id/runs` | Last 20 runs, newest first, each with its assertion results |
| `GET` | `/tests/:id/incidents` | The test's incident history as time windows (start, end, duration, failed runs, ongoing). Kept for compatibility; use `/incidents` for stored incidents |
| `POST` | `/tests/:id/run` | Run now: one attempt, no retries. Returns the run. 404 unknown test, 422 paused, 409 a run is already in progress |
| `GET` | `/tests/:id/run/stream` | Run now as Server-Sent Events: `log` events with `{ message }` for each `ctx.log`, then `done` with the run or `error` with `{ error }` |
| `GET` | `/tests/:id/channels` | Channels assigned directly to the test |
| `GET` | `/tests/:id/channels/effective` | Every channel that fires for the test, direct or through a tag, with its event types and source |
| `POST` | `/tests/:id/channels` | Assign: `{ channel_id, event_types? }`. `event_types` is a non-empty subset of `fail`, `warning`, `recovery` (default all three). 201 |
| `DELETE` | `/tests/:id/channels/:channel_id` | Unassign. 204 |

Test fields: `name`, `code`, `schedule_ms` (at least 30 000), `timeout_ms` (at least 1000, default 5000, at most 80% of `schedule_ms`), `retries` (0–5, default 0), `enabled` (default true), `failure_threshold` (default 3), `cooldown_ms` (default 86 400 000), `tags` (up to 20). `uses_browser` is accepted for compatibility and does nothing.

### Bulk actions

```http
POST /tests/bulk
{ "ids": ["abc", "def"], "action": "add_tag", "tag": "tier:core" }
```

`action` is `enable`, `disable`, `run`, `delete`, `add_tag` or `remove_tag` (`tag` required for the last two). Up to 200 ids, applied in one transaction. The reply has one result per id:

```json
{ "action": "run", "results": [ { "id": "abc", "ok": true, "started": true }, { "id": "def", "ok": false, "error": "test is disabled" } ] }
```

`run` starts one run of each test; results arrive in each test's run history.

### Export and import

```bash
# Save
curl -s -H "Authorization: Bearer <token>" \
  http://localhost:3001/tests/export > backup.json

# Restore on a new instance
curl -s -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d @backup.json \
  http://localhost:3001/tests/import
```

Channels, assignments and secrets are not part of the export.

## Dashboard

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/dashboard` | Every test with its last run result, 7-day pass rate, average latency, state, consecutive failures, threshold, problem window and `section`, ordered by section. `?tag=` filters by tag, `?section=critical,warning` by section |

## Tags

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/tags` | Distinct tags across tests |
| `GET` | `/tags/:tag/channels` | Channels assigned to the tag |
| `POST` | `/tags/:tag/channels` | Assign: `{ channel_id, event_types? }`. 201 |
| `DELETE` | `/tags/:tag/channels/:channel_id` | Unassign. 204 |

## Channels

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/channels` | All channels. Bot tokens are never returned; `has_bot_token` says whether one is stored |
| `POST` | `/channels` | Create. 201 |
| `PATCH` | `/channels/:id` | Partial update, validated against the merged row. Passing `bot_token` replaces the stored token |
| `DELETE` | `/channels/:id` | Deletes the channel and its assignments. 204 |
| `POST` | `/channels/:id/test` | Sends a one-off test message. Returns `{ ok, http_status }`; 502 with the reason when delivery fails |

Channel fields: `name`, `type` (`discord`, `slack`, `webhook`, `email`, `discord_bot`, `slack_bot`), `enabled`, and per type `webhook_url`, `email_to` (1–10 addresses), or `bot_token` plus `channel_ref`. See [Notifications](../guide/notifications.md).

## Secrets

Values are write-only: no response ever contains one.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/secrets` | Names and timestamps |
| `GET` | `/secrets/status` | `{ encryptionEnabled: boolean }` |
| `POST` | `/secrets` | `{ name, value }`; `name` is `UPPER_SNAKE_CASE`. 201; 409 when the name exists |
| `POST` | `/secrets/:id/rotate` | `{ value }` |
| `DELETE` | `/secrets/:id` | 204 |

## Incidents

Signed in. See [Status and incidents](../guide/status-and-incidents.md#incidents) for the rules.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/incidents` | `?state=open\|resolved\|all` (default `all`). Open first, then newest. Each item has its tests and `report_state` (`none`, `draft`, `published`) |
| `GET` | `/incidents/:id` | Tests, full timeline and report with `sections.<summary\|impact\|root_cause\|resolution\|follow_ups>.internal/public` |
| `PATCH` | `/incidents/:id` | `{ title?, state? }`. Writes a timeline entry |
| `POST` | `/incidents/:id/tests` | `{ test_id }`. 201 with the incident; 409 when already linked |
| `POST` | `/incidents/:id/updates` | `{ body, public }`. 201. `public: true` is 403 for tokens |
| `PUT` | `/incidents/:id/report` | Partial: only the sections and versions sent are replaced |
| `POST` | `/incidents/:id/publish` | Person only (403 for tokens) |
| `POST` | `/incidents/:id/unpublish` | Person only |
| `POST` | `/incidents/:id/report/publish` | Person only. 404 without a report, 400 when it has no public text |

## Status page (public)

No auth. Replies are cached in-process for 30 s per set of parameters.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/status` | Every test: state, 30 days of daily outcomes, 30-day uptime, problem window, `section` |
| `GET` | `/status/tags` | Distinct tags |
| `GET` | `/status/tag/:tag` | Same as `/status` for one tag; 404 when no test has it |
| `GET` | `/status/test/:id` | One test |
| `GET` | `/status/test/:id/events` | Recent runs with assertions. `?limit=` 1–50 (default 20), `?after=` / `?before=` ISO timestamps. Kept for compatibility; the web no longer uses it |
| `GET` | `/status/buckets` | History in 100 buckets (30 daily buckets for `30d`). `?period=1h\|24h\|7d\|30d` (default `24h`), `?tag=`, `?testId=`. Unknown period is a 400 |
| `GET` | `/status/incidents` | Published incidents that are open or started in the last 30 days. `?tag=` limits them to that tag's tests |
| `GET` | `/status/incidents/:id` | One published incident: title, state, times, affected check names, public notes, public report. 404 unless published |

## Operations

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | `{ status: "ok" }` when the database answers, else 503 `{ status: "error", error }` |
| `GET` | `/metrics` | Prometheus text format |

Metrics:

| Metric | Type | Counts |
| --- | --- | --- |
| `sentinel_check_duration_ms` | Histogram | Run duration |
| `sentinel_check_success_total` | Counter | Passed runs |
| `sentinel_check_warnings_total` | Counter | Warned runs |
| `sentinel_check_failures_total` | Counter | Failed and Timed out runs |

## MCP server

`POST /mcp` speaks MCP over Streamable HTTP, statelessly (a fresh server per request), so agents such as Claude Code can operate an instance. It uses the same bearer auth as the REST API. `GET` and `DELETE` on `/mcp` return 405.

### Setup

1. Open **API tokens** at `/admin/tokens` (or call `POST /auth/mcp-token` with a login token) and generate a token. Give it a label so notes show who wrote them.
2. Run the command the page shows:

```bash
claude mcp add sentinel --transport http https://your-host/api/mcp \
  --header "Authorization: Bearer <token>"
```

Use `<url>/mcp` for a standalone API (for example `http://localhost:3001/mcp`). Each Sentinel instance is its own MCP server: add one entry per instance.

The server's `instructions` and the tool descriptions are everything an agent knows about Sentinel; they are a condensed copy of the guides and are kept in step with them.

### Tools

29 tools. Writes go through the REST routes in-process, so validation and errors are the same.

| Group | Tool | Does |
| --- | --- | --- |
| Tests | `list_tests` | List tests, optionally by tag |
| | `get_test` | One test with its code |
| | `create_test` | Create a test |
| | `update_test` | Partial update; `enabled: false` pauses |
| | `delete_test` | Delete a test and its runs |
| | `bulk_update_tests` | Enable, pause, run, delete or re-tag up to 200 tests |
| | `run_test_now` | One attempt now; returns the run with its `ctx.log` output |
| | `get_test_runs` | Last 20 runs with assertions |
| | `get_test_incidents` | One test's incident windows (compatibility) |
| Incidents | `list_incidents` | Stored incidents, open first |
| | `get_incident` | Tests, timeline and both report versions |
| | `add_incident_note` | Internal note on the timeline |
| | `set_incident_state` | Change state or title |
| | `link_incident_test` | Link another test by hand |
| | `draft_incident_report` | Write report sections; stays a draft |
| Overview | `get_dashboard_summary` | Dashboard by section, filterable by tag and sections |
| | `get_status` | What the status page shows |
| | `list_tags` | Distinct tags |
| Channels | `list_channels` | All channels |
| | `create_channel` | Create a channel |
| | `update_channel` | Partial update |
| | `delete_channel` | Delete a channel and its assignments |
| | `test_channel` | Send a one-off test message |
| | `assign_channel` | Assign to a test or tag, optionally per event type |
| | `unassign_channel` | Remove an assignment |
| Secrets | `list_secrets` | Names, timestamps, whether encryption is on |
| | `create_secret` | Create a secret |
| | `rotate_secret` | Replace a value |
| | `delete_secret` | Delete a secret |

No tool publishes an incident, a public note or a report.
