# Sentinel — Project

This file is the single source of truth for what gets built. Features are grouped by milestone. The **Current Focus** section at the top is the only thing AI should pick up and implement — everything else is backlog.

To start a feature: move it (or describe it) into **Current Focus**. When done, mark it complete and pick the next one.

---

## Current Focus

### F-23 · Status Pages Should Allow for more granular checks

Status pages (and dashboard) should allow for viewing more granular checks, for example, allowing the user to see every check that happened in the last hour, 24 hours, 7 days and 30 days. Default should be showing last checks for 24 hours. Each test box should show a fixed bunch of boxes (similar to Github status pages) that would group checks happened for that fraction. For example, say we have 100 boxes and we're seeing the 24 hour period, then, each box would represent 2.88 minutes of time. The box should be colored in red if both checks failed at that period, yellow if at least one check failed at that period and green if none failed.

A selector should allow for choosing which period are we seeing.

When hovering a status box, a small panel should show: - the ammount of tests in that period; - the average response time; - how many failed/how many passed

---

## Milestone 1 — Core Engine (MVP)

### ✅ F-01 · Database Schema & Migrations

Set up the Postgres schema with all tables from the domain model: `tests`, `test_runs`, `assertion_results`, `uptime_daily`, `notification_channels`, `test_state`. Use time-based partitioning on `test_runs` (monthly). Plain SQL migration files in `apps/api/src/db/migrations/`.

**Done when:** running `node migrate.js` against a fresh Postgres instance creates all tables with correct columns, indexes, and constraints.

---

### ✅ F-02 · API — Test CRUD

`POST /tests`, `GET /tests`, `GET /tests/:id`, `PATCH /tests/:id`, `DELETE /tests/:id`. Validates input with Zod schemas from `@sentinel/shared`. Writes to/reads from Postgres via raw SQL. Returns typed JSON.

**Done when:** can create, read, update, and delete a test via the API; invalid input returns 400 with error detail.

---

### ✅ F-03 · Execution Engine

Compile user JS code on save via `new Function('ctx', code)` and cache. On execution: build `ctx` object (with `ctx.http` via undici, `ctx.log`, `ctx.now()`), run compiled function, enforce timeout with `Promise.race`. Return `{ status, duration_ms, error_message }`.

**Done when:** a test that does `return (await ctx.http.get(url)).status === 200` executes correctly and timeouts are enforced.

---

### ✅ F-04 · Scheduler

On startup, register a `setInterval` for each enabled test. Apply jitter (`interval + random(0, interval * 0.1)`). Use `p-limit` to cap concurrency at 10 HTTP tests. Skip run if queue is full (log + continue). Reload schedules when tests are created/updated/deleted via in-process event.

**Done when:** 50 tests with 30s intervals all fire on schedule without piling up; a queue-full scenario skips gracefully.

---

### ✅ F-05 · Result Persistence

Buffer `TestRun` rows in memory after each execution. Flush to Postgres in batches (max 100 rows, every 2 seconds) using a single `INSERT`. Update `test_state` row (upsert) after each run. Never write individual rows in a loop.

**Done when:** results appear in DB within 3 seconds of execution; 500 concurrent results don't cause connection pool exhaustion.

---

### ✅ F-06 · Daily Aggregation

A daily cron (midnight UTC) computes `uptime_daily` stats per test from that day's `test_runs`. Upserts one row per `(test_id, date)`. Prunes `test_runs` partitions older than 7 days. Prunes `uptime_daily` rows older than 90 days.

**Done when:** after a day of test runs, `uptime_daily` has correct `success_count`, `failure_count`, `avg_latency_ms` for each test.

---

### ✅ F-07 · Notifications

State-transition alerting: pass→fail (after `failure_threshold` consecutive failures and cooldown elapsed) and fail→pass. Dispatches to all enabled `notification_channels` (Discord/Slack/webhook) via undici POST. Fire-and-forget. Rich payloads: failure reason, response time, downtime duration on recovery. Discord uses coloured embeds; Slack uses attachments. `failure_threshold` and `cooldown_ms` are per-test columns (defaults: 3 / 5 min).

**Done when:** a test that fails 3 times in a row sends a Discord embed with the error reason; a recovery sends an embed with downtime duration; a single flaky failure sends nothing.

---

### ✅ F-08 · Prometheus Metrics

Register with `prom-client`: `sentinel_check_duration_ms` (histogram), `sentinel_check_failures_total` (counter), `sentinel_check_success_total` (counter). Expose at `GET /metrics`. Updated after every test run.

**Done when:** `curl /metrics` returns valid Prometheus text format with all three metrics.

---

### ✅ F-09 · Web — Dashboard (Test List)

Next.js page at `/` (server component). Fetches all tests from the API. Displays a table: test name, status badge (pass/fail/unknown), last run time, 7-day pass rate from `uptime_daily`. No client-side data fetching.

**UI:** Dark background (`zinc-950`). Sparse table — no borders between rows, only subtle row hover. Status badge: colored dot + label (emerald for pass, red for fail, zinc for unknown). 7-day pass rate as a plain percentage — no chart needed here.

**Done when:** the dashboard loads and shows the correct status for each test; page renders without client JS.

---

### ✅ F-10 · Web — Test Editor

Page at `/tests/new` and `/tests/[id]/edit`. Monaco Editor (dynamically imported, `ssr: false`) for editing JS code. Form fields for name, interval, timeout. On save, calls the API. Basic error display.

**UI:** Two-column layout — left: form fields (name, interval, timeout, enabled toggle); right: Monaco editor taking full remaining height. Monaco configured with dark theme matching app background, Consolas font. Validation errors appear inline below each field, not in a toast. Save button is the only prominent action.

**Done when:** can create a new test with JS code in the editor and have it appear in the dashboard.

---

### ✅ F-11 · Web — Test Detail

Page at `/tests/[id]`. Shows: last 20 runs with status badge + duration + error message. Link to edit. Delete button with confirmation.

**UI:** Run history as a compact list — each row: timestamp, status dot, duration in ms, error message (truncated, expandable). Delete uses a shadcn `AlertDialog` for confirmation — not a browser `confirm()`. Edit is a plain text link, not a button.

**Done when:** can navigate to a test, see its run history, and delete it.

---

### ✅ F-12 · Web — Public Status Page

Page at `/status` (no auth). Server-rendered from `uptime_daily` only — no raw `test_runs` queries. Shows each test: name, current status, 30-day uptime %, 30-day daily history bar. Fast static render (ISR, 5-minute revalidation).

**UI:** Centered narrow layout (max-w-2xl). Each test is a card with: name, uptime % in large type, 30-day bar (30 colored squares — emerald/red/zinc per day). No navigation, no sidebar. This page is meant to be embedded or shared — keep it self-contained and load-fast.

**Done when:** `/status` loads without auth, is fast, and shows 30-day history correctly.

---

## Milestone 2 — Enhanced Execution

### ✅ F-13 · Named Assertions

`ctx.assert(name, value, message?)` — records individual assertion results as `assertion_results` rows linked to the `test_run`. Test still passes/fails as a whole, but individual assertions are stored and displayed.

### ✅ F-14 · "Run Now" Button

API endpoint `POST /tests/:id/run` triggers immediate execution outside the scheduler. Returns the `TestRun` result synchronously (with a reasonable timeout). Web UI button on the test detail page.

### ✅ F-15 · Real-Time Log Streaming

When a "run now" is triggered, stream `ctx.log()` output back to the browser via SSE (`GET /tests/:id/run/stream`). Display in a live console on the test detail page.

### F-16 · Playwright Browser Tests

Per-test opt-in (`uses_browser: true`). Separate execution queue with `p-limit(1)`. Playwright launched as a child process, not in the main event loop. Results recorded same as HTTP tests.

### ✅ F-17 · Test Groups & Tags

Add `tags: string[]` to the `Test` entity. Filter dashboard by tag. Group-level public status page at `/status/[tag]`.

---

## Milestone 3 — Auth & Operations

### ✅ F-18 · JWT Authentication

`POST /auth/login` returns a JWT. All non-public API routes require `Authorization: Bearer <token>`. Single hardcoded admin credential for MVP (env vars). Public status pages remain unauthenticated.

### ✅ F-19 · Export / Import Tests

`GET /tests/export` returns all test definitions as JSON. `POST /tests/import` bulk-creates tests from the same format. Useful for backup and migration.

### ✅ F-20 · Incident Timeline

On the test detail page, show a timeline of incidents (contiguous failure periods) with start time, end time, and duration. Derived from `test_runs` or a new `incidents` table.

### ✅ F-21 · Notification Channel Management

Refactor `notification_channels` into a global named-channel registry: drop `test_id`, add a `name` column. Add CRUD API routes (`POST /channels`, `GET /channels`, `PATCH /channels/:id`, `DELETE /channels/:id`) and a web UI page at `/channels` to create, edit, and delete channels.

### ✅ F-22 · Channel Assignments

Add a `channel_assignments (channel_id, scope_type: 'test'|'tag', scope_value)` table. API routes to assign/unassign channels to a test or a tag. Update the notifier to resolve channels as the union of direct test assignments and tag-based assignments (deduplicated). Add assignment picker UI to the test editor (per-test channels) and a tag-level assignment panel on the `/channels` page.

### F-23 · Status Pages Should Allow for more granular checks

Status pages (and dashboard) should allow for viewing more granular checks, for example, allowing the user to see every check that happened in the last hour, 24 hours, 7 days and 30 days. Default should be showing last checks for 24 hours. Each test box should show a fixed bunch of boxes (similar to Github status pages) that would group checks happened for that fraction. For example, say we have 100 boxes and we're seeing the 24 hour period, then, each box would represent 2.88 minutes of time. The box should be colored in red if both checks failed at that period, yellow if at least one check failed at that period and green if none failed.

A selector should allow for choosing which period are we seeing.

When hovering a status box, a small panel should show: - the ammount of tests in that period; - the average response time; - how many failed/how many passed

---

### ✅ F-24 · FTP Probe Support

Add `ctx.ftp.ls(url, options?)` and `ctx.ftp.get(url, options?)` to the test `ctx` API, using `basic-ftp` (zero runtime deps). `ls` returns directory listings (`{ name, type, size, modifiedAt }[]`); `get` downloads a file and returns `{ body, size }`. Downloads are written to a server-managed temp file, read, and deleted before the call returns — files are never persisted past the test run. Capped by `FTP_MAX_DOWNLOAD_BYTES` (default 5MB); a periodic sweep job cleans up any orphaned temp file as a backstop for crashes/timeouts.

**Done when:** a test can `ctx.ftp.ls`/`ctx.ftp.get` against a real FTP server, and no file remains under `FTP_TEMP_DIR` after the run completes (normal or error path).

---

### ✅ F-25 · Configurable Test Timeout

Remove the flat 10-second `timeout_ms` cap. Replace it with a relative rule: `timeout_ms <= schedule_ms * 0.8`, enforced in the Zod schema (create), a Postgres `CHECK` constraint (create + update), and the test editor UI. Added a per-test overlap guard in the scheduler so two scheduler-triggered runs of the same test can never be in flight simultaneously, since timeout can now approach the test's own interval.

**Done when:** creating a test with `timeout_ms` close to or exceeding 80% of `schedule_ms` is rejected (API and UI); a test whose run takes longer than its own interval logs a skip instead of overlapping.

---

### ✅ F-26 · Encrypted Secret Store

Global, write-only key-value secret store so credentials don't get hardcoded into test `code`. New `secrets` table; values encrypted at rest with AES-256-GCM (`node:crypto`) under an optional `SECRETS_ENCRYPTION_KEY` env var (optional, not required, so existing deployments don't break on upgrade — if unset, values are stored unencrypted and the dashboard shows a warning banner). Exposed to test code as `ctx.secrets.NAME`, backed by an in-memory cache decrypted once at startup and refreshed on every write so the executor never queries the DB or does crypto per test run. `POST/GET/DELETE /secrets`, `POST /secrets/:id/rotate`, `GET /secrets/status`; a `/secrets` dashboard page for create/rotate/delete.

**Done when:** a test can read `ctx.secrets.API_KEY`; no API response ever includes a secret's value after creation; the API boots and `ctx.secrets` still works with `SECRETS_ENCRYPTION_KEY` unset; one undecryptable secret is skipped with a logged warning instead of crashing the process at startup.

---

## Maintenance Tasks

### ✅ M-01 · Semantic Release

Add a workflow to create semantic releases from this app, generating changelog notes every release

### ✅ M-02 · Single Deployment Through Docker

Create a Dockerfile to pack everything (API + APP) into a single deployment. Create a CI to build it whenever there's a new release. Use the tag paschendale/sentinel

### ✅ M-03 · Standalone API Deployment

Create a Dockerfile to pack the API into a standalone deployment, useful when working with Cloudflare. Create a CI to build it whenever there's a new release. Use the tag paschendale/sentinel-api

### ✅ M-04 · Documentation

Create a small user documentation explaining deployment, creation of tests, and whatever else you feel interesting. Put it on the main README.md

### ✅ M-05 · Automated tests

Create an automated test workflow, which should be a pre-requisite to every build workflow. Create a coverage report, add badges to the README

### M-06 · Coverage Push to 90% (API)

Current baseline (Mar 26, 2026) from `pnpm --filter @sentinel/api test:coverage`:
- Statements: 45.69%
- Branches: 38.98%
- Functions: 48.06%
- Lines: 47.34%

Target:
- Reach at least 90% statements and 90% lines in `apps/api`.

Coverage tasks:

1) **Auth layer hardening (`src/auth/jwt.ts`, `src/routes/auth.ts`)**
- Add unit tests for JWT sign/verify success path, invalid token handling, missing secret, and expiration behavior.
- Add route tests for login success and all failure cases (invalid credentials, malformed body, missing fields).
- **Done when:** auth modules are >=90% line coverage and all auth error branches are exercised.

2) **Executor core tests (`src/executor/compile.ts`, `src/executor/ctx.ts`, `src/executor/run.ts`)**
- Add focused unit tests for code compilation success/failure, timeout behavior, runtime exception handling, and result shaping.
- Add tests for `ctx.http` wrapper behavior (status/error mapping) and `ctx.assert` recording hooks where applicable.
- **Done when:** executor package reaches >=85% line coverage and timeout/error branches are covered.

3) **Route integration matrix (`src/routes/tests.ts`, `src/routes/run.ts`, `src/routes/channels.ts`, `src/routes/dashboard.ts`, `src/routes/metrics.ts`)**
- Add Fastify injection tests for CRUD happy paths + validation failures + edge cases (not found, invalid ids, empty payloads).
- Add tests for run-now endpoint success and failure paths.
- Add channels/tag assignment route tests for invalid scope/tag normalization and dedupe behavior.
- **Done when:** routes folder reaches >=90% line coverage with both happy and failure paths tested.

4) **Notifier behavior coverage (`src/notifier/dispatch.ts`)**
- Add unit tests for transition logic (pass->fail threshold, fail->pass recovery), cooldown checks, and payload format generation.
- Mock outbound HTTP calls and assert destination-specific payload transformations (Discord/Slack/Webhook).
- **Done when:** notifier module reaches >=90% line coverage and transition/cooldown branches are validated.

5) **DB query and state transitions (`src/db/queries/*`, `src/db/result-buffer.ts`, `src/db/aggregator.ts`)**
- Add tests for uncovered query helpers (especially assignments), including SQL parameter shape and returned mapping behavior.
- Extend existing tests with batch flush edge cases and aggregation boundaries (empty day, all failures, mixed runs).
- **Done when:** db + queries combined coverage reaches >=92% line coverage.

6) **Coverage gates in CI**
- Configure Vitest coverage thresholds (`lines: 90`, `statements: 90`) in API test config.
- Enforce `pnpm --filter @sentinel/api test:coverage` in CI as a required check.
- **Done when:** PRs fail automatically if coverage drops below threshold.