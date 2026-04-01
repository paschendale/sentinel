# Implementation Log

A running record of what was built and why. Append-only — do not edit past entries.
AI agents must append an entry here after completing any feature from PROJECT.md.

## 2026-04-01 · API · Readable test + scheduler log lines

**What was built:** Default local API runs now use `pino-pretty` (via `LOG_PRETTY`, on by default when `NODE_ENV` is not `production`) so test lifecycle, `ctx.log`, HTTP steps, and completion lines are readable in the terminal instead of opaque JSON. Executor log `msg` strings include `test_id`, `run_id`, trigger, HTTP summaries, and pass/fail/timeout with duration and assertion counts. Added `NODE_ENV` / `LOG_PRETTY` to config; Vitest forces `LOG_PRETTY=false`. Added `pino-pretty` as an API devDependency and documented it in `ARCHITECTURE.md`. Scheduler messages include `test_id` in the human-readable line.

**Files changed:**
- `apps/api/src/config.ts` — `NODE_ENV`, `LOG_PRETTY`
- `apps/api/src/logger.ts` — conditional `pino-pretty` transport
- `apps/api/src/executor/run.ts` — richer `msg` text for start/HTTP/user log/complete
- `apps/api/src/scheduler/index.ts` — clearer scheduler `msg` lines
- `apps/api/vitest.config.ts` — `LOG_PRETTY=false` for tests
- `apps/api/package.json` — `pino-pretty` devDependency
- `docs/ARCHITECTURE.md`, `README.md` — env + approved dep

**Decisions:** `pino-pretty` stays a devDependency: production Docker sets `NODE_ENV=production` and `pnpm deploy --prod` omits dev deps; logs stay JSON there. Local `tsx` / `pnpm dev` gets pretty output by default.

**Deferred:** None.

## 2026-04-01 · API · Test-focused structured logging

**What was built:** Introduced a shared Pino root logger (`LOG_LEVEL` from config) and wired Fastify with `loggerInstance` plus `disableRequestLogging`, logging inbound requests only when `statusCode >= 400`. The executor now emits structured events for each run (`test.run.start` / `test.run.complete`), every `ctx.log` line (`test.user_log`), and each successful outbound HTTP call (`test.http` with method, truncated URL, status, duration). `runTest` takes `{ trigger, onLog? }` for scheduler vs API POST vs SSE. The scheduler uses the same logger instead of `console.*`.

**Files changed:**
- `apps/api/src/config.ts` — optional `LOG_LEVEL` (default `info`)
- `apps/api/src/logger.ts` — root Pino instance
- `apps/api/src/server.ts` — `loggerInstance`, `disableRequestLogging`, `onResponse` warn hook for error statuses
- `apps/api/src/executor/ctx.ts` — `onHttpComplete` / `HttpCompleteInfo`, timing in `doFetch`
- `apps/api/src/executor/run.ts` — `RunTestOptions`, child logger, always-on ctx + HTTP logging
- `apps/api/src/routes/run.ts` — triggers `api-post` / `api-sse`
- `apps/api/src/scheduler/index.ts` — `scheduler` child logger, `trigger: 'scheduler'`
- `README.md` — documented `LOG_LEVEL`

**Decisions:** Fastify 5 expects a logger *configuration* for `logger:` but accepts a pre-built Pino via `loggerInstance` (passing a bare instance to `logger` throws). Inbound error logging uses the shared root logger so it matches executor output format.

**Deferred:** `POST /tests/:id/run` still does not return `ctx.log` lines in JSON (SSE only); no DB persistence of user logs.

## 2026-03-25 · F-23 · Granular Status History

**What was built:** Added a 1h/24h/7d/30d period selector to all status pages and the dashboard. Each period renders a row of equal-width buckets (100 for sub-30d, 30 for 30d) colored green (all pass), yellow (mixed), or red (all fail), with a hover tooltip showing run count, avg latency, and pass/fail breakdown.

**Files changed:**
- `packages/shared/src/types.ts` — added `StatusPeriod`, `StatusBucket`, `StatusBucketTest` types
- `apps/api/src/routes/status.ts` — added public `GET /status/buckets?period=&tag=` endpoint; uses `test_runs` (100 buckets) for 1h/24h/7d, `uptime_daily` (30 buckets) for 30d
- `apps/web/app/status/_components/status-buckets-view.tsx` — new client component rendering bucket boxes + hover tooltip
- `apps/web/app/status/_components/status-page-content.tsx` — new client wrapper with period state, fetches bucket data, renders all test cards
- `apps/web/app/status/page.tsx` + `[slug]/page.tsx` — now delegate history rendering to `StatusPageContent`
- `apps/web/app/_components/dashboard-table.tsx` — new client component; replaces the 7-day pass rate column with a History column + shared period selector
- `apps/web/app/page.tsx` — passes test list to `DashboardTable`

**Decisions:** The 30d period uses `uptime_daily` (daily granularity, naturally 30 buckets) since `test_runs` are pruned after 7 days. The new yellow "degraded" state distinguishes partial failures from total outages. Uptime % in status page cards is recomputed client-side from bucket totals to reflect the selected period. Status pages remain ISR server components for fast initial load; the client wrapper hydrates and switches periods without a full page reload.

**Deferred:** No per-test independent period selector (all tests on a page share one selector). Dashboard buckets use the same public endpoint — no auth filtering since bucket data is aggregated.

## 2026-03-24 · F-06 · Daily Aggregation

**What was built:** A daily cron (`aggregator.ts`) that fires at midnight UTC, upserts `uptime_daily` stats from the prior day's `test_runs`, drops `test_runs` monthly partitions older than 7 days, and prunes `uptime_daily` rows older than 90 days. Wired into the process lifecycle alongside the scheduler and result flusher.
**Files changed:**
- `apps/api/src/db/aggregator.ts` (new)
- `apps/api/src/db/aggregator.test.ts` (new — 12 unit tests)
- `apps/api/src/index.ts` (wired startAggregator/stopAggregator)

**Decisions:** Each of the three SQL steps is wrapped in an independent try/catch so a pg_class failure (e.g. permissions) cannot block the uptime_daily prune. Partition names are fetched from pg_class with a parameterized regex to avoid client-side assumptions; the YYYY_MM month value (1-indexed) is used directly as the 0-indexed Date month argument, which naturally yields the start of the *next* month as the partition end bound. No transaction is needed — all three operations are idempotent.
**Deferred:** No integration test (would require a real seeded DB with time-partitioned data); partition creation for future months is handled by the initial migration, not the aggregator.

---

## 2026-03-25 · F-18 · JWT Authentication

**What was built:** HS256 JWT auth using Node.js built-in `crypto` (no new dependency). `POST /auth/login` validates admin credentials from env vars and returns a signed token. All non-public API routes require `Authorization: Bearer <token>` or `?token=` query param (for EventSource SSE). `config.ts` refactored to a `requireEnv()` helper. Web app gets a `/login` page, Next.js middleware for unauthenticated redirects, and auth headers wired into all Server Component fetches and client-side fetch/SSE calls.
**Files changed:**
- `apps/api/src/config.ts` (refactored to requireEnv helper, added ADMIN_USERNAME/ADMIN_PASSWORD/JWT_SECRET)
- `apps/api/src/auth/jwt.ts` (new — HS256 sign/verify)
- `apps/api/src/routes/auth.ts` (new — POST /auth/login)
- `apps/api/src/server.ts` (auth onRequest hook, Authorization CORS header, auth route registration)
- `apps/web/middleware.ts` (new — redirect to /login if no sentinel_token cookie)
- `apps/web/app/login/page.tsx` (new — login form)
- `apps/web/lib/auth-client.ts` (new — getToken(), authHeaders() for client components)
- `apps/web/lib/auth-server.ts` (new — serverAuthHeaders() for Server Components)
- `apps/web/app/page.tsx`, `apps/web/app/tests/[id]/page.tsx`, `apps/web/app/tests/[id]/edit/page.tsx` (auth headers on server-side fetches)
- `apps/web/app/tests/_components/test-editor.tsx`, `delete-test-button.tsx`, `run-now-panel.tsx` (auth headers on client fetches; SSE uses ?token=)

**Decisions:** Used Node.js `crypto` module directly for HS256 JWT to avoid adding a dependency. SSE stream accepts `?token=` query param since `EventSource` API cannot send custom headers. JWT stored in a `sentinel_token` cookie (readable by both server and client) so Server Components can forward the token to the API. Middleware only checks cookie existence (not JWT validity) — the API performs actual verification.
**Deferred:** Token refresh, logout route, and multiple admin users — all deferred for post-MVP.

<!-- entries go here, newest at the bottom -->

## 2026-03-25 · F-19 · Export / Import Tests

**What was built:** `GET /tests/export` returns all test definitions as a `{ tests: [...] }` JSON object with `id`/`created_at`/`updated_at` stripped (CreateTest-compatible format). `POST /tests/import` accepts the same format, validates every entry with `CreateTestSchema`, bulk-inserts all tests in a single transaction, and emits `test:created` events so the scheduler picks them up immediately.
**Files changed:**
- `apps/api/src/routes/tests.ts` — added export and import route handlers

**Decisions:** Import uses an acquired client (not the pool directly) to run `BEGIN`/`COMMIT`/`ROLLBACK` around all inserts; each test gets a fresh `nanoid`. Validation errors are collected per-index and returned as a map so the caller can identify which entries are invalid. Scheduler events are emitted only after the full transaction commits.
**Deferred:** Notification channels are not exported/imported alongside tests — deferred for a later pass.

---

## 2026-03-25 · F-20 · Incident Timeline

**What was built:** `GET /tests/:id/incidents` queries the last 500 runs for a test (ordered by `started_at`), groups contiguous non-success runs in application code, and returns incidents newest-first. Each incident includes `started_at`, `ended_at`, `duration_ms` (wall time), `failure_count`, and an `ongoing` flag. The test detail page fetches incidents in parallel with runs and renders an `IncidentTimeline` component showing start/end times, duration, and failed check count. Ongoing incidents display a pulsing red "Ongoing" badge.
**Files changed:**
- `apps/api/src/routes/tests.ts` — added incidents route handler
- `packages/shared/src/types.ts` — added `Incident` interface
- `apps/web/app/tests/[id]/page.tsx` — parallel incident fetch, `<IncidentTimeline>` section
- `apps/web/app/tests/_components/incident-timeline.tsx` (new) — incident table component

**Decisions:** Derived incidents from `test_runs` in application code rather than adding a new `incidents` table — keeps the schema simple and avoids write-time complexity. The 500-row cap prevents unbounded queries on high-frequency tests while still covering meaningful history. Duration is wall-clock elapsed time (ended_at − started_at) rather than sum of run durations, which is more meaningful for assessing downtime impact.
**Deferred:** Pagination of incident history; configurable lookback window.

## 2026-03-24 · F-07b · Enriched Notifications + Per-Test Config

**What was built:** Upgraded notification payloads to include failure reason (error_message), response time, and downtime duration on recovery. Discord uses coloured embeds (red/green); Slack uses attachments with a colour bar. Per-test `failure_threshold` and `cooldown_ms` columns added to the `tests` table via migration `002_notification_config.sql`, replacing the previous hardcoded constants. The DB query in `runNotifications` now JOINs `tests` to read per-test thresholds. `lastNotifiedAt` is captured before being cleared on recovery so the downtime duration can be computed accurately.

**Files changed:**
- `apps/api/src/db/migrations/002_notification_config.sql` (new) — ALTER TABLE adds `failure_threshold` and `cooldown_ms`
- `packages/shared/src/types.ts` — added `failure_threshold`, `cooldown_ms` to `Test`
- `packages/shared/src/schemas.ts` — added both fields to `CreateTestSchema` / `UpdateTestSchema`
- `apps/api/src/notifier/dispatch.ts` — rich embeds/attachments, per-test config, downtime calc, `formatDuration` helper
- `apps/api/src/db/result-buffer.ts` — passes `error_message` and `duration_ms` in `NotificationCandidate`

**Decisions:**
- `lastNotifiedAt` is passed into `dispatchForTest` as a parameter (captured before the UPDATE clears it) so downtime is correct even though the DB is already updated.
- Discord uses `embeds[]` (not `content`) for structured fields; Slack uses legacy `attachments` (widely supported, no OAuth needed for incoming webhooks).
- `formatDuration` produces human-readable strings like "2h 10m", "5m 34s", "8s".
- Per-test defaults (threshold=3, cooldown=5min) match the previously hardcoded values, so existing behaviour is unchanged for tests that don't override them.

**Deferred:** Notification channel CRUD endpoints (needed for F-10 web editor); quiet hours / escalation policy.

---

## 2026-03-24 · F-07 · Notifications

**What was built:** State-transition-based notification dispatch. After each batch flush, `flushTestState` fetches the previous `last_status` for all affected tests, performs the upsert as before, then fires `triggerNotifications()` (fire-and-forget). The notifier filters for pass→fail and fail→pass transitions, checks `consecutive_failures >= 3` and 5-minute cooldown before dispatching fail alerts, and sends recovery alerts only when a prior fail notification was sent (non-null `last_notification_at`). Payloads are dispatched via undici POST to Discord, Slack, or generic webhook channels; each dispatch is wrapped in try/catch. `last_notification_at` is set to `NOW()` on fail and `NULL` on recovery.

**Files changed:**
- `apps/api/src/notifier/dispatch.ts` (new) — `triggerNotifications`, transition filtering, threshold/cooldown checks, webhook dispatch
- `apps/api/src/db/result-buffer.ts` — added prev-state SELECT before upsert; added `triggerNotifications` call after upsert
- `apps/api/src/db/result-buffer.test.ts` — updated call-count assertions (2→3) and call-index refs (1→2) for the new SELECT

**Decisions:**
- Prev-state SELECT runs before the upsert (not after) so transition direction is unambiguous without storing old values.
- `last_notification_at` is updated before dispatching to webhooks to prevent duplicate alerts in case of partial webhook failures.
- Recovery sends only if `last_notification_at != null` to avoid spurious recovery pings for tests that never crossed the failure threshold.
- Recovery resets `last_notification_at` to NULL so the next failure cycle starts with a clean cooldown window.

**Deferred:** Per-channel failure threshold or cooldown overrides; notification channel CRUD endpoints (needed by F-10 web editor).


## 2026-03-23 · F-01 · Database Schema & Migrations

**What was built:** Plain SQL migration file creating all six domain tables (`tests`, `test_runs`, `assertion_results`, `uptime_daily`, `notification_channels`, `test_state`) with constraints, indexes, and monthly range partitioning on `test_runs`. A `tsx`-based migration runner tracks applied migrations via a `schema_migrations` table and runs each file in a transaction.

**Files changed:**
- `apps/api/src/db/migrations/001_initial_schema.sql` — full DDL for all tables and initial partitions
- `apps/api/src/db/migrate.ts` — migration runner script
- `apps/api/src/config.ts` — exports `DATABASE_URL` from env (single env-var entry point per RULES.md)
- `apps/api/package.json` — added `"migrate": "tsx src/db/migrate.ts"` script

**Decisions:**
- `test_runs` PK is `(id, started_at)` because Postgres requires the partition key in every unique constraint on a partitioned table.
- No hard FK from `assertion_results` → `test_runs`: enforcing it would require `started_at` in `assertion_results`, which the domain model doesn't include. Integrity is application-enforced.
- Monthly partitions are created via a `DO` block at apply-time so filenames are calendar-correct without hardcoding dates.

**Deferred:** Logic to create new monthly partitions automatically (needed for F-06 daily aggregation job).

## 2026-03-23 · F-02 · API — Test CRUD

**What was built:** Five REST endpoints (`POST /tests`, `GET /tests`, `GET /tests/:id`, `PATCH /tests/:id`, `DELETE /tests/:id`) on a Fastify v5 server. Input validation uses existing Zod schemas from `@sentinel/shared`. All DB access is raw SQL via a `pg.Pool` singleton. IDs generated with `nanoid`.

**Files changed:**
- `apps/api/src/db/pool.ts` — pg Pool singleton (max 5 connections)
- `apps/api/src/routes/tests.ts` — all five route handlers
- `apps/api/src/server.ts` — Fastify instance with route plugin registration
- `apps/api/src/index.ts` — entry point that starts the server on port 3000

**Decisions:**
- PATCH builds a dynamic SET clause from Zod-parsed keys (field names are never raw user input, safe to interpolate); also sets `updated_at = NOW()` on each update.
- 400 returned for both schema violations (via `safeParse`) and empty PATCH bodies.
- 404 for GET/PATCH/DELETE on unknown IDs; 204 no body on successful DELETE.

**Deferred:** Route-level JSON schema for Fastify serialization (perf optimization); pagination for GET /tests.

## 2026-03-23 · F-03 · Execution Engine

**What was built:** Core test execution engine: a compile-and-cache module (`compile.ts`) that wraps user code via `new Function('ctx', code)` and caches compiled functions per test ID; a `ctx` builder (`ctx.ts`) providing `ctx.http` (undici), `ctx.assert`, `ctx.log`, and `ctx.now()`; a `runTest` function (`run.ts`) that executes the compiled function with `Promise.race` timeout enforcement and persists results to `test_runs` + `assertion_results`. A `POST /tests/:id/run` endpoint exposes manual execution.

**Files changed:**
- `apps/api/src/executor/compile.ts` — compile cache with invalidation
- `apps/api/src/executor/ctx.ts` — sandboxed `ctx` object builder
- `apps/api/src/executor/run.ts` — execution, timeout, DB persistence
- `apps/api/src/routes/run.ts` — `POST /tests/:id/run` handler
- `apps/api/src/routes/tests.ts` — calls `invalidateCache` on PATCH and DELETE
- `apps/api/src/server.ts` — registers `runRoutes`

**Decisions:**
- Timeout uses a plain `Promise.race` against a `setTimeout` rejection — no extra dependency.
- `ctx.assert` throws on failure so the executor catches it as `status: 'fail'`; the throw message is preserved as `error_message`.
- Timeout vs non-timeout errors distinguished by checking if the message starts with "Timed out after", keeping the sentinel string in one place.
- Assertion results inserted in one bulk query after execution to avoid per-assertion round-trips.

**Deferred:** Retry logic (`test.retries`); `uses_browser` (Playwright) path; `TestState` update after each run; scheduler integration.

## 2026-03-23 · F-04 · Scheduler

**What was built:** An in-process scheduler that fires each enabled test on its configured interval. On startup it loads all enabled tests from the DB and registers a `setInterval` per test with jitter (`schedule_ms + random(0, schedule_ms * 0.1)`). Concurrency is capped at 10 via `p-limit`; if the limiter is saturated when an interval fires, the run is skipped with a warning log. Tests are kept in sync with CRUD operations via an in-process `EventEmitter` (`testEvents`) whose events are emitted by the CRUD routes.

**Files changed:**
- `apps/api/src/events.ts` — singleton `EventEmitter` for test lifecycle events
- `apps/api/src/scheduler/index.ts` — `startScheduler`, `stopScheduler`, `register`, `unregister`
- `apps/api/src/routes/tests.ts` — emits `test:created`, `test:updated`, `test:deleted` after each mutation
- `apps/api/src/index.ts` — calls `startScheduler()` after server build, before `listen()`

**Decisions:**
- Used Node.js built-in `EventEmitter` instead of a third-party pub/sub; no new deps required.
- `p-limit.activeCount >= CONCURRENCY` check before queuing ensures tasks are dropped (not queued) when at capacity, preventing pile-up.
- Jitter is applied once per `register()` call (not recalculated each tick) to keep timer management simple while still staggering tests registered at the same moment.

**Deferred:** `TestState` update after each scheduled run; retry logic; `uses_browser` (Playwright) path.

## 2026-03-24 · F-08 · Prometheus Metrics

**What was built:** Three prom-client metrics registered at startup — `sentinel_check_duration_ms` (histogram), `sentinel_check_failures_total` (counter), `sentinel_check_success_total` (counter) — and exposed at `GET /metrics` in standard Prometheus text format. Metrics are updated after every flush cycle in `result-buffer.ts`.

**Files changed:**
- `apps/api/src/metrics/index.ts` — new module: metric definitions, `recordTestResult` helper, re-exports `register`
- `apps/api/src/routes/metrics.ts` — new route: `GET /metrics` returns `register.metrics()` with correct `Content-Type`
- `apps/api/src/server.ts` — registered `metricsRoutes` without a prefix
- `apps/api/src/db/result-buffer.ts` — calls `recordTestResult(r.status, r.duration_ms)` for each row after successful DB flush

**Decisions:**
- Metrics are recorded after DB writes succeed (not fire-and-forget before), so counter values reflect persisted results — a failed flush does not increment metrics.
- All rows in the flush batch are recorded individually (not deduped), giving accurate histogram observations and counts per test run.
- Default prom-client registry is used (no custom registry) — standard single-process setup.

**Deferred:** Per-test labels (e.g. `test_id`) were not added to avoid high cardinality; can be opt-in later.

---

## 2026-03-24 · F-09 · Web — Dashboard (Test List)

**What was built:** First frontend feature — a server-rendered Next.js 15 dashboard at `/` showing all tests with live status, last run time, and 7-day pass rate. Added a new `GET /dashboard` API endpoint that joins `tests`, `test_state`, and `uptime_daily` in a single SQL query to return enriched `TestSummary` rows. The Next.js app was scaffolded from scratch (Tailwind CSS, PostCSS, `next.config.ts`, root layout, globals.css).

**Files changed:**
- `packages/shared/src/types.ts` — added `TestSummary` interface
- `apps/api/src/routes/dashboard.ts` (new) — `GET /dashboard` with join query
- `apps/api/src/server.ts` — registered `dashboardRoutes` at prefix `/dashboard`
- `apps/web/package.json` — added tailwindcss, postcss, autoprefixer devDeps
- `apps/web/tailwind.config.ts` (new)
- `apps/web/postcss.config.js` (new)
- `apps/web/next.config.ts` (new)
- `apps/web/app/globals.css` (new)
- `apps/web/app/layout.tsx` (new)
- `apps/web/app/page.tsx` (new) — server component dashboard

**Decisions:**
- A dedicated `/dashboard` endpoint (not the existing `GET /tests`) avoids N+1 queries for status and pass rate — one SQL query returns everything needed.
- Pass rate computed in SQL with `ROUND(100.0 * SUM(success) / NULLIF(total, 0))` to handle tests with no history (returns NULL → renders as "—").
- `last_run_at` relative time formatting done server-side with plain `Date` arithmetic — no client-side library, no JS required in the browser.
- `export const dynamic = 'force-dynamic'` disables Next.js caching so the page always reflects current test state.

**Deferred:** Navigation header, links to test detail page (F-11), and pagination (tests list is unbounded for now).

---

## 2026-03-23 · F-05 · Result Persistence

**What was built:** An in-memory result buffer (`result-buffer.ts`) that accumulates `RunResult` rows after each test execution and flushes them to Postgres in batches — up to 100 rows per flush, triggered every 2 seconds or when the buffer hits 100. A single multi-row `INSERT` writes all `test_runs` at once; a deduplicated multi-row upsert (latest result per `test_id`) updates `test_state`. The direct single-row INSERT was removed from the executor, and graceful shutdown drains the buffer before exit.

**Files changed:**
- `apps/api/src/db/result-buffer.ts` — new module: `enqueue`, `startFlusher`, `stopFlusher`, `flush`
- `apps/api/src/executor/run.ts` — removed direct `test_runs` INSERT; cleaned unused `TestRun` import
- `apps/api/src/scheduler/index.ts` — added `.then(enqueue)` to p-limit callback
- `apps/api/src/routes/run.ts` — added `enqueue(result)` after manual run
- `apps/api/src/index.ts` — wired flusher lifecycle; added SIGTERM/SIGINT graceful shutdown

**Decisions:**
- `flushInProgress` boolean guard prevents concurrent flush invocations from competing for connections when a 100-row threshold flush and a timer flush overlap.
- Buffer is swapped atomically (reassign to `[]`) before any `await`, so `enqueue()` calls during a flush write into a fresh array and are not lost.
- On flush error, rows are prepended back to the buffer for retry on the next tick.
- `flushTestRuns` and `flushTestState` are sequential (not parallel) to cap peak connection usage at 1 during a flush cycle, well within the `max: 5` pool.
- `last_notification_at` is excluded from the `test_state` upsert — that column is owned by F-07.

**Deferred:** Retry logic; `uses_browser` path; assertion_results are still written immediately in the executor (not buffered) — buffering them would add complexity for minimal gain given they are already batched per run.

## 2026-03-24 · F-10 · Web — Test Editor

**What was built:** `/tests/new` and `/tests/[id]` pages with a two-column layout — form fields on the left, Monaco Editor on the right. Users can create and edit tests with name, interval, timeout, and enabled fields plus JS code. Saving calls the Fastify API and redirects to the dashboard.

**Files changed:**
- `apps/web/app/tests/_components/test-editor.tsx` — client component with Monaco (dynamic import, ssr: false), inline validation, and POST/PATCH API calls
- `apps/web/app/tests/new/page.tsx` — server component wrapper for new test
- `apps/web/app/tests/[id]/page.tsx` — server component that fetches existing test and pre-fills the editor
- `apps/web/app/page.tsx` — added "+ new test" link and clickable test name links to editor

**Decisions:** Monaco is dynamically imported with `ssr: false` as required. API URL uses `NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'` in the client component; server-rendered pages keep using `API_URL`. Interval and timeout are stored in ms but displayed/entered in seconds for readability. Validation errors appear inline below each field.

**Deferred:** Delete button, confirmation dialog, test run history on the edit page.

---

## 2026-03-24 · F-10 · Web — Test editor follow-up (CORS, first run, run UX)

**What was built:** The API now sends CORS headers and short-circuits `OPTIONS` with 204 so the Next.js app on another origin can call REST endpoints from the browser without a proxy. The scheduler runs an enabled test once immediately when it is created (in addition to the interval), so the dashboard shows a real status instead of lingering on unknown. The test editor calls `POST /tests/:id/run` with a **Run now** button and shows status, duration, and error inline; **Run now** is disabled while Monaco code differs from the last saved `test.code`, with helper text explaining that the server runs persisted code only.

**Files changed:**
- `apps/api/src/server.ts` — `onRequest` hook: `Access-Control-*` headers, `OPTIONS` → 204
- `apps/api/src/scheduler/index.ts` — `test:created` handler enqueues `runTest` → `enqueue` when `test.enabled`
- `apps/web/app/tests/_components/test-editor.tsx` — Run control, `codeDirty` vs `test.code`, helper copy
- (Initial F-10 paths also under `apps/web/app/tests/` and `apps/web/app/page.tsx` — see prior log entry.)

**Decisions:** CORS is implemented with a Fastify hook instead of `@fastify/cors` to avoid adding a dependency outside the approved list. Immediate run reuses the same `runTest` + `enqueue` path as scheduled runs. Dirty detection is code-only so users can still run after changing metadata without saving.

**Deferred:** Same as F-10 (delete, confirmations, run history on edit page); optional `router.refresh` or stay-on-save to avoid full list navigation after save.

---

## 2026-03-24 · F-11 · Web — Test Detail

**What was built:** `GET /tests/:id/runs` returns the last 20 `test_runs` for a test (404 if the test does not exist). The web app uses `/tests/[id]` for a server-rendered detail view with run history (timestamp, status, duration, expandable error text), a plain **Edit** link to `/tests/[id]/edit`, and **Delete** behind a Radix `AlertDialog` (no `window.confirm`). The Monaco editor moved to `/tests/[id]/edit`; saving redirects back to the detail page.

**Files changed:**
- `apps/api/src/routes/tests.ts` — `GET /:id/runs` before `GET /:id`
- `apps/web/app/tests/[id]/page.tsx` — detail page
- `apps/web/app/tests/[id]/edit/page.tsx` — editor route (new)
- `apps/web/app/tests/_components/test-editor.tsx` — back link + post-save navigation
- `apps/web/app/tests/_components/run-history.tsx`, `delete-test-button.tsx`, `ui/alert-dialog.tsx` (new)
- `apps/web/package.json` — `@radix-ui/react-alert-dialog`, `clsx`
- `PROJECT.md` — Current Focus → F-12; F-10 path note; F-11 marked done

**Decisions:** Editor at `/edit` avoids conflicting with the detail URL required by F-11. Alert dialog primitives mirror shadcn’s Radix wrapper without the full CLI; destructive confirm uses a plain `<button>` so the dialog stays open until `DELETE` succeeds. Tailwind `animate-in` utilities were omitted (no `tailwindcss-animate` plugin).

**Deferred:** API route test for `GET /:id/runs` (optional); integration test failures observed locally are pre-existing DB/fixture issues, not this change.

---

## 2026-03-24 · Web — Test detail layout, code preview, latency chart

**What was built:** The test detail page is full-width (`w-full`, no `max-w-3xl`). A read-only **Code** panel shows `test.code` in a monospace `<pre>` (no Monaco). A **Latency** chart uses Recharts `ComposedChart`: line for `duration_ms` (oldest→newest) and red `Bar` ticks for failed/timeout runs. **Recent runs** is a full-width semantic `<table>` with horizontal scroll on narrow viewports. Recharts is loaded via a client `run-latency-chart-loader` using `next/dynamic` + `ssr: false` (Next 15 forbids that pattern in Server Components).

**Files changed:**
- `apps/web/app/tests/[id]/page.tsx` — layout grid, code block, chart loader
- `apps/web/app/tests/_components/run-latency-chart.tsx`, `run-latency-chart-loader.tsx` (new)
- `apps/web/app/tests/_components/run-history.tsx` — table layout
- `apps/web/package.json`, `pnpm-lock.yaml` — `recharts`
- `docs/ARCHITECTURE.md` — approved `recharts`; bundle note (dynamic import)

**Decisions:** Chart data reverses the API’s newest-first run list for left-to-right time flow. Loading placeholder is a static skeleton (no pulse) to stay within “calm motion” guidance. Tooltip omits the failure series row when absent.

**Deferred:** None.

---

## 2026-03-24 · F-12 · Web — Public Status Page

**What was built:** `GET /status` on the API returns per-test 30-day aggregates from `uptime_daily` plus test id/name/enabled (two SQL queries, merge in TypeScript). Each payload includes 30 UTC calendar days (oldest→newest), per-day up/down/unknown from daily success/failure counts, a rounded 30-day uptime percentage, and `current_status` from the newest day in the window that has any runs (aggregated-only; no `test_state` or `test_runs`). The Next.js app serves `/status` with `revalidate = 300` and `fetch(..., { next: { revalidate: 300 } })`: cards (`max-w-2xl`), large uptime %, 30-square bar, disabled tests muted; no nav.

**Files changed:**
- `packages/shared/src/types.ts` — `PublicStatusOutcome`, `PublicStatusDay`, `PublicStatusTest`
- `apps/api/src/routes/status.ts` (new), `apps/api/src/server.ts` — register `/status`
- `apps/web/app/status/page.tsx` (new)
- `PROJECT.md` — F-12 complete; Current Focus → F-13

**Decisions:** Postgres `CURRENT_DATE` aligns with server UTC for the `uptime_daily` date filter; the 30-day axis is built in JS with `Date.UTC` so it matches that window even if session TZ differed. Any failure on a day marks the square red; all-success days are emerald; no data is zinc.

**Deferred:** None.

---

## 2026-03-24 · F-13 · Named Assertions

**What was built:** Assertion results are now surfaced on the test detail page. `GET /tests/:id/runs` was extended to batch-fetch `assertion_results` for the returned run IDs in a single extra query, grouping them by `test_run_id` and embedding them inline in each run object. The web `RunHistory` component now renders assertion results under each run row: emerald `✓` for passing, red `✗` with optional message for failing. The column header was renamed from "Error" to "Details".

**Files changed:**
- `apps/api/src/routes/tests.ts` — batch assertion query + inline embed in `GET /:id/runs`
- `apps/web/app/tests/[id]/page.tsx` — map `assertions` field from API response
- `apps/web/app/tests/_components/run-history.tsx` — `assertions` in `RunRow`; inline assertion list in `RunRowView`

**Decisions:** Assertions are embedded in the existing runs endpoint (not a separate `GET /:id/runs/:runId/assertions`) to avoid extra per-row round trips from the page. The DB side (`ctx.assert`, `assertion_results` table, batch INSERT in `runTest`) was already complete from F-03.

**Deferred:** None.

---

## 2026-03-24 · F-14 + F-15 · Run Now Button & Real-Time Log Streaming

**What was built:** Added a "Run now" button on the test detail page that streams `ctx.log()` output live via SSE. A new `GET /tests/:id/run/stream` endpoint hijacks the Fastify response and writes SSE frames (`log`, `done`, `error`) as the test executes. The `buildCtx()` and `runTest()` functions accept an optional `onLog` callback, which fires each log immediately rather than buffering. The `RunNowPanel` client component opens an `EventSource`, renders streaming logs in a small console, and shows the final result on completion.

**Files changed:**
- `apps/api/src/executor/ctx.ts` — added `BuildCtxOptions` interface with `onLog?`; `buildCtx()` calls it on each `ctx.log()`
- `apps/api/src/executor/run.ts` — `runTest()` accepts optional `onLog` and passes it to `buildCtx()`
- `apps/api/src/routes/run.ts` — added `GET /:id/run/stream` SSE route using `reply.hijack()` + `reply.raw`
- `apps/web/app/tests/_components/run-now-panel.tsx` (new) — `RunNowPanel` client component
- `apps/web/app/tests/[id]/page.tsx` — imports and renders `RunNowPanel` in the header

**Decisions:**
- Combined GET endpoint (triggers + streams) rather than POST→then→SSE avoids a coordination step; `EventSource` only supports GET natively.
- `reply.hijack()` gives full control of the raw Node.js socket so Fastify doesn't interfere with SSE headers.
- `onLog` is optional with no default so scheduler-triggered runs are unaffected (zero regression risk).

**Deferred:** Logs are not persisted to the DB — they are ephemeral, streaming-only. Persisting logs would require a new table and was not part of the spec.

---

## 2026-03-24 · F-14 + F-15 · Run Now UI polish

**What was built:** Improved the `RunNowPanel` layout so the header is never disrupted. The button and a result badge (`success · 42ms`) stay inline in the header row. Log output appears in a fixed floating console anchored to the bottom-right (VS Code terminal style) with a pulsing indicator while running, a dismiss button, and a result footer.

**Files changed:**
- `apps/web/app/tests/_components/run-now-panel.tsx` — refactored to `<>` fragment: inline button/badge + fixed floating console
- `apps/web/app/tests/[id]/page.tsx` — changed header alignment from `items-baseline` to `items-center`

## 2026-03-25 · F-17 · Test Groups & Tags

**What was built:** Added `tags: string[]` to the `Test` entity. Tags are stored as a PostgreSQL `TEXT[]` column. The dashboard now shows clickable tag pills per test and a tag filter bar (`/?tag=<name>`). The test editor has a comma-separated tags input field. A new public status page at `/status/[slug]` renders uptime data for all tests with that tag. The main `/status` page links to tag pages via tag pills on each card.

**Files changed:**
- `apps/api/src/db/migrations/003_tags.sql` — new migration adding `tags TEXT[] NOT NULL DEFAULT '{}'`
- `packages/shared/src/types.ts` — `tags` added to `Test`, `TestSummary`, `PublicStatusTest`
- `packages/shared/src/schemas.ts` — `tags` added to `CreateTestSchema` (max 20 tags, each max 50 chars)
- `apps/api/src/routes/tests.ts` — INSERT includes `tags`; GET supports `?tag=` filter
- `apps/api/src/routes/dashboard.ts` — `tags` in SELECT; `?tag=` filter on `WHERE $1 = ANY(t.tags)`
- `apps/api/src/routes/status.ts` — `tags` in TestRow; new `GET /status/tag/:tag` route
- `apps/web/app/tests/_components/test-editor.tsx` — comma-separated tags input with live pill preview
- `apps/web/app/page.tsx` — tag filter pill bar; tag pills on each test row
- `apps/web/app/status/[slug]/page.tsx` — new ISR page fetching `/status/tag/:slug`

**Decisions:** Used PostgreSQL `TEXT[]` for tags — no join table needed at this scale. Tag filtering uses `$1 = ANY(tags)` which is efficient without an index for typical test counts. The filter pill bar derives tags from the currently visible tests; when filtering, "All" resets to show everything. The `/status/[slug]` page returns 404 if no tests match.

**Deferred:** Full-text tag search, tag autocomplete in the editor, and a dedicated tags management page are out of scope.

## 2026-03-25 · F-21 · Notification Channel Management

**What was built:** Refactored `notification_channels` from a test-scoped table into a global named-channel registry. Added CRUD API routes at `/channels` and a `/channels` web page with inline create/edit/delete UI. Updated the notifier to broadcast to all enabled channels (stopgap until F-22 adds assignment-based targeting).
**Files changed:**
- `apps/api/src/db/migrations/004_channel_registry.sql` — drops `test_id`, adds `name` with backfill
- `packages/shared/src/types.ts` — `NotificationChannel`: removed `test_id`, added `name`
- `packages/shared/src/schemas.ts` — updated `CreateNotificationChannelSchema`, added `UpdateNotificationChannelSchema`
- `apps/api/src/routes/channels.ts` — new Fastify plugin (GET/POST/PATCH/DELETE)
- `apps/api/src/server.ts` — registers `channelsRoutes` at `/channels`
- `apps/api/src/notifier/dispatch.ts` — channel query now uses `CROSS JOIN tests` (no `test_id` filter)
- `apps/web/app/channels/page.tsx` — server component, fetches and renders channel list
- `apps/web/app/channels/_components/channel-manager.tsx` — client component with full CRUD UI
- `apps/web/app/page.tsx` — added channels nav link

**Decisions:** The notifier temporarily broadcasts to ALL enabled channels per test event. This keeps notifications functional between F-21 and F-22 (which will introduce `channel_assignments` for targeted routing). Delete confirmation uses an inline two-step pattern rather than importing AlertDialog across feature boundaries.
**Deferred:** Assignment of channels to specific tests or tags is deferred to F-22.

## 2026-03-25 · F-22 · Channel Assignments

**What was built:** Added a `channel_assignments` table that maps notification channels to tests or tags. API routes let you assign/unassign channels per test (`/tests/:id/channels`) and per tag (`/tags/:tag/channels`). The notifier's broadcast `CROSS JOIN` was replaced with a targeted query that resolves channels as the union of direct test assignments and tag-based assignments (deduplicated via `DISTINCT`). A channel picker (pills + dropdown) was added to the test editor, and a tag assignment panel was added to `/channels`.
**Files changed:**
- `apps/api/src/db/migrations/005_channel_assignments.sql` (new)
- `apps/api/src/db/queries/assignments.ts` (new)
- `apps/api/src/routes/tags.ts` (new)
- `apps/api/src/routes/tests.ts` — added GET/POST/DELETE `/:id/channels` routes
- `apps/api/src/server.ts` — registered tags router
- `apps/api/src/notifier/dispatch.ts` — replaced CROSS JOIN with assignment-based query
- `packages/shared/src/types.ts` — added `ChannelAssignment` interface
- `packages/shared/src/schemas.ts` — added `CreateAssignmentSchema`
- `apps/web/app/tests/_components/test-editor.tsx` — added channel picker UI
- `apps/web/app/channels/page.tsx` — fetch tags and tag assignments server-side
- `apps/web/app/channels/_components/tag-assignment-panel.tsx` (new)

**Decisions:** Assignment sync on test save uses a diff approach (fetch existing, add/remove deltas) via `Promise.all` so it's fast and idempotent. The `DISTINCT` in the notifier query handles the case where a channel is assigned both directly to a test and via a shared tag. Tests with no assignments now receive no notifications (correct behavior replacing the old broadcast).
**Deferred:** Nothing.

## 2026-04-01 · F-03 · Executor HTTP redirect handling

**What was built:** Extended `ctx.http` to support explicit redirect handling and clearer fetch failures. `ctx.http.get/post` now accept `redirect: 'follow' | 'manual' | 'error'`, and redirect-loop failures are surfaced as a dedicated `HttpRequestError` with code `HTTP_REDIRECT_ERROR` instead of a generic `fetch failed`.
**Files changed:**
- `apps/api/src/executor/ctx.ts` — added redirect option plumbing and explicit `HttpRequestError` classification for redirect-limit vs generic fetch failures
- `apps/api/src/executor/ctx.test.ts` (new) — tests for redirect mode forwarding and error classification
- `docs/DOMAINS.md` — documented `RequestOptions.redirect` in the `ctx` API contract

**Decisions:** Kept backward-compatible default redirect behavior (`follow`) while allowing tests to opt into `manual` for endpoints where a 3xx response is expected and acceptable. Error classification is done centrally in `doFetch` so test authors can catch and branch on `error.code`.
**Deferred:** No UI/editor affordance yet for inserting redirect options into test snippets; this remains code-driven in user test bodies.

## 2026-04-01 · Docs · Redirect handling in test HTTP API

**What was built:** Added README documentation for `ctx.http` redirect handling, including the new `redirect` option (`follow`/`manual`/`error`), when redirect loops occur, and a concrete GeoServer-style example showing how to treat `3xx` as a valid reachable check with `redirect: 'manual'`.
**Files changed:**
- `README.md` — expanded `ctx.http` section with redirect options and example; aligned `ctx.http.post` examples with the current runtime signature

**Decisions:** Documented `manual` as the recommended approach for uptime checks against redirect-heavy UI endpoints, while keeping `follow` as the default behavior for most API checks.
**Deferred:** No dedicated troubleshooting section for other fetch failure classes yet (`HTTP_FETCH_ERROR` examples can be added later if needed).

## 2026-03-25 · M-01 · Semantic Release

**What was built:** Added semantic-release automation that triggers on every push to `main`, analyzes Conventional Commits to determine the version bump, generates a CHANGELOG.md, bumps the root `package.json` version, commits the changes back, and creates a GitHub Release with the generated notes.
**Files changed:**
- `.github/workflows/release.yml` (new) — GitHub Actions workflow
- `.releaserc.json` (new) — semantic-release plugin configuration
- `package.json` (root) — added semantic-release and its plugins as devDependencies
- `pnpm-lock.yaml` — updated lockfile

**Decisions:** All packages are `private: true` so `@semantic-release/npm` is used with `npmPublish: false` solely to handle version bumping in `package.json`. The release commit message includes `[skip ci]` to prevent the workflow from re-triggering on its own commit. `fetch-depth: 0` in the checkout step is required for semantic-release to traverse the full commit history back to the last tag.
**Deferred:** Nothing.

## 2026-03-25 · M-02 + M-03 · Docker Deployment

**What was built:** Two Docker images — `paschendale/sentinel` bundles API + Web in a single container behind a Caddy reverse proxy (API at `/api/*`, Web at `/*`, both on port 80); `paschendale/sentinel-api` is a standalone API-only image on port 3001. Both images are built and pushed to Docker Hub automatically via GitHub Actions on every GitHub release.

**Files changed:**
- `Dockerfile` (new) — root multi-stage build for M-02 (API + Web + Caddy)
- `Caddyfile` (new) — Caddy config routing `/api/*` → Fastify:3001, `/*` → Next.js:3000
- `docker-entrypoint.sh` (new) — starts API + Web in background, Caddy as PID 1
- `apps/api/Dockerfile` (new) — standalone API-only image for M-03
- `.github/workflows/docker.yml` (new) — two parallel jobs building both images on release
- `.dockerignore` (new) — excludes node_modules, dist, .next, .env files
- `apps/web/next.config.ts` — added `output: 'standalone'` for optimized Docker builds

**Decisions:** `NEXT_PUBLIC_API_URL=/api` is baked into the image at build time so browser calls resolve correctly through Caddy; server components use `API_URL=http://localhost:3001` to call Fastify directly (bypassing the proxy). `pnpm deploy --prod` creates a self-contained API node_modules including `@sentinel/shared` source. Caddy runs as PID 1 to receive SIGTERM cleanly on container stop. The `/api` path was chosen because Next.js App Router has no `app/api/` directory, so there's no routing conflict.

**Deferred:** Nothing.

## 2026-03-25 · M-02 + M-03 · Docker runtime fixes

**What was built:** Resolved four runtime failures in the sentinel Docker image: missing `server.js` (Next.js standalone path in pnpm monorepo), `@sentinel/shared` TypeScript source being imported at runtime, missing SQL migration files in the runner, and missing `apps/api/package.json` causing an ESM type warning. Also wired migrations to run automatically on API startup.
**Files changed:**
- `Dockerfile` — added `outputFileTracingRoot`-aware standalone COPY, SQL migrations COPY, api package.json COPY, compiled shared dist copy
- `apps/api/Dockerfile` — same SQL migrations and package.json fixes
- `apps/web/next.config.ts` — added `outputFileTracingRoot` for correct monorepo standalone output
- `packages/shared/package.json` — added `build` script, changed exports default to `./dist/index.js`
- `packages/shared/tsconfig.json` — added `outDir`/`rootDir` for compilation
- `apps/api/src/db/migrate.ts` — exported `migrate()` function, kept CLI auto-run via argv guard
- `apps/api/src/index.ts` — call `migrate()` before server startup

**Decisions:** `pnpm deploy` respects `.gitignore` and skips `dist/`; shared dist is built then copied manually into the deploy. SQL files are placed at `dist/db/migrations/` to match `__dirname`-relative paths in compiled migrate.js. Migrations are idempotent so automatic startup runs are safe.
**Deferred:** Nothing.

## 2026-03-25 · M-04 · Documentation

**What was built:** Rewrote `README.md` with comprehensive user documentation covering deployment (Docker Compose, Cloudflare variant, single container), local development setup, authentication, the full `ctx` API with examples, scheduling parameters, notification channels, status pages, Prometheus metrics, and export/import. Added two Docker Compose files: `docker-compose.yml` (full stack) and `docker-compose.cloudflare.yml` (API + DB only for Cloudflare Pages users).
**Files changed:**
- `README.md` — full rewrite
- `docker-compose.yml` — new, full stack (postgres + sentinel image on port 80)
- `docker-compose.cloudflare.yml` — new, minimal stack (postgres + sentinel-api on port 3001)

**Decisions:** Kept the existing export/import section content intact. Cloudflare compose uses `sentinel-api` image and exposes port 3001 directly, leaving the web frontend for Cloudflare Pages to host separately.
**Deferred:** Nothing.

## 2026-03-25 · M-05 · Automated Tests

**What was built:** Added test CI workflow (`test.yml`) that runs on every push and PR to main with a PostgreSQL service container. Coverage reporting via `@vitest/coverage-v8` with JSON output uploaded to Codecov. Updated `release.yml` to run tests as a prerequisite job before semantic-release. Added CI and coverage badges to the README.
**Files changed:**
- `.github/workflows/test.yml` — new, runs tests + coverage on push/PR
- `.github/workflows/release.yml` — added `test` job, made `release` depend on it
- `apps/api/vitest.config.ts` — added coverage config (v8 provider, JSON reporter)
- `apps/api/package.json` — added `@vitest/coverage-v8` devDep, `test:coverage` script
- `package.json` (root) — added `test` script

**Decisions:** Tests require `@sentinel/shared` to be built first; both workflows include a `Build shared package` step before running tests. Coverage threshold not enforced (no `thresholds` config) to avoid breaking CI on new code paths; can be tightened later. The `test` job in `release.yml` duplicates `test.yml` rather than using `workflow_run` to avoid trigger ordering complexity.
**Deferred:** Web app (`apps/web`) has no test coverage — no framework configured there.

## 2026-03-25 · M-05 · CI fix — run migrations before integration tests

**What was built:** Integration tests require the Postgres schema to exist before running. Added a `migrate:ci` script (no `--env-file` flag, which Node 20 rejects when the file is absent) and a migration step in both `test.yml` and `release.yml` that runs before the test step using workflow env vars.
**Files changed:**
- `apps/api/package.json` — added `migrate:ci` script
- `.github/workflows/test.yml` — added migration step
- `.github/workflows/release.yml` — added migration step

**Decisions:** Kept the original `migrate` script unchanged (uses `--env-file .env` for local dev). The CI variant skips that flag since env vars are injected by the workflow.
**Deferred:** Nothing.

## 2026-03-25 · M-05 · CI fix — correct badge URLs and self-hosted coverage badge

**What was built:** Fixed test badge URL (was pointing to wrong org). Replaced Codecov (requires CODECOV_TOKEN secret) with `jaywcjlove/coverage-badges-action` which reads the vitest `coverage-summary.json`, generates an SVG badge, and commits it to `.badges/coverage.svg` with `[skip ci]` to avoid looping. Badge is only committed on pushes to main, not PRs.
**Files changed:**
- `README.md` — fixed test badge URL, switched coverage badge to local SVG
- `.github/workflows/test.yml` — added `permissions: contents: write`, replaced Codecov step with badge generation + commit steps

**Decisions:** Self-hosted badge avoids any external service dependency (Codecov, shields.io endpoint). The SVG file is committed directly to the repo so it's always served from GitHub's CDN.
**Deferred:** Nothing.

## 2026-03-26 · Fix · HttpResponse.json() method

**What was built:** Added `json()` method to the `HttpResponse` interface returned by `ctx.http.get/post`. Previously `res.body` was always a plain string, but the README documented it as auto-parsed JSON and test examples used `res.body.property` and `res.json()` patterns that would throw at runtime.
**Files changed:**
- `apps/api/src/executor/ctx.ts` — added `json(): unknown` to `HttpResponse` interface; `doFetch` now returns `json: () => JSON.parse(body)`
- `README.md` — corrected `ctx.http` documentation and all code examples to use `res.json()` for JSON parsing
**Decisions:** Fixed in the app rather than patching individual tests — all existing tests using `res.json()` now work without changes, and the API is consistent with the native fetch pattern.
**Deferred:** Tests in the database that use `res.body.property` (without `json()`) are still broken; they are not covered by this fix since they access string properties.

## 2026-03-26 · bugfix · Production URL construction crash + hydration mismatch (F-23 regression)

**What was built:** Fixed two production bugs introduced by the F-23 commit.
**Files changed:**
- `apps/web/app/_components/dashboard-table.tsx` — replaced `new URL(API_URL + path)` with `URLSearchParams`-based string; added `suppressHydrationWarning` on `<time>` element
- `apps/web/app/status/_components/status-page-content.tsx` — same URL construction fix

**Decisions:** `new URL(str)` requires an absolute URL; in production `NEXT_PUBLIC_API_URL` is a relative path, causing an immediate throw. Switched to plain string concatenation with `URLSearchParams` which works for both relative and absolute bases. `suppressHydrationWarning` on `<time>` is the correct targeted fix for a timestamp whose relative representation legitimately differs between SSR and client hydration.
**Deferred:** Nothing.

## 2026-03-26 · Dashboard sortable columns + avg response time

**What was built:** Added sortable column headers (Name, Status, Last Run, Avg Response) to the dashboard test table. Added a new "Avg Response" column showing the 7-day average latency in ms sourced from `uptime_daily`.
**Files changed:**
- `packages/shared/src/types.ts` — added `avg_latency_ms: number | null` to `TestSummary`
- `apps/api/src/routes/dashboard.ts` — added `ROUND(AVG(ud.avg_latency_ms))::integer AS avg_latency_ms` to both SQL query branches
- `apps/web/app/_components/dashboard-table.tsx` — added `SortKey` type, `sortTests` function, `SortIcon` component, sort state, and sortable `<th>` buttons; added Avg Response cell
**Decisions:** Sorting is client-side since tests arrive as server-rendered props — avoids extra API roundtrip. Nulls always sort to the bottom regardless of direction. Clicking the active column reverses direction; clicking a new column resets to ascending.
**Deferred:** Nothing.

## 2026-03-26 · F-07/F-22 · Persist Notification Delivery Events

**What was built:** Added append-only `notification_events` persistence so notifier decisions and delivery outcomes are auditable in Postgres. The notifier now records `evaluated`, `skipped`, `attempted`, `sent`, and `failed` phases with reasons (e.g. threshold/cooldown/no_channels/http errors), channel linkage, and HTTP status when present.
**Files changed:**
- `apps/api/src/db/migrations/006_notification_events.sql` (new) — creates `notification_events` table and debug indexes
- `apps/api/src/db/queries/notification-events.ts` (new) — typed helper to insert event rows
- `apps/api/src/notifier/dispatch.ts` — instrumented gating and send flow; logs phase/reason rows; captures non-2xx as failure events
- `apps/api/src/notifier/dispatch.test.ts` — added coverage for skipped/attempted/sent/failed event logging scenarios
**Decisions:** Event writes are best-effort and non-blocking (`logNotificationEventSafe`) to preserve existing fire-and-forget notifier resilience. No new API/UI surface was added in this pass; DB telemetry is internal-only for operational debugging.
**Deferred:** Public/privileged API endpoints for querying notification events were intentionally deferred.

## 2026-03-26 · F-22 · Tag Notification Dispatch Normalization Fix

**What was built:** Fixed tag-based channel routing so notification dispatch is resilient to case and whitespace differences. Tags are now normalized at test write boundaries and tag-assignment route boundaries, and dispatch query matching now normalizes both assignment and test tag values to avoid silent misses from legacy mixed formatting.
**Files changed:**
- `apps/api/src/tags/normalize.ts` (new) — shared tag normalization and dedupe helpers
- `apps/api/src/routes/tests.ts` — normalizes/dedupes tags on create, patch, and import
- `apps/api/src/routes/tags.ts` — normalizes tag params for GET/POST/DELETE and rejects invalid empty tags
- `apps/api/src/notifier/dispatch.ts` — normalized SQL matching for tag assignments (`LOWER(BTRIM(...))`)
- `apps/api/src/routes/tags.test.ts` (new) — covers invalid tag rejection and normalized assignment persistence
- `apps/api/src/routes/tests-normalization.test.ts` (new) — covers normalized/deduped test tags on create/patch
- `apps/api/src/notifier/dispatch.test.ts` (new) — covers normalized dispatch SQL and fail/recovery send path
**Decisions:** Normalization is performed at both write time and match time. Write-time normalization prevents new drift; match-time normalization ensures backward compatibility with existing rows that may already contain inconsistent casing/spacing.
**Deferred:** Existing persisted tag values are not backfilled in DB via migration yet; runtime matching now handles mixed historical data.

## 2026-03-26 · F-07 · Notify Eligible Unnotified Failures

**What was built:** Updated notifier evaluation so failing tests are checked on every failing candidate, not only `success -> fail` transitions. This ensures tests that crossed threshold during an ongoing outage are still notified and recorded in `notification_events` as attempted/sent/failed or skipped with reason (e.g. cooldown active).
**Files changed:**
- `apps/api/src/notifier/dispatch.ts` — replaced transition-only fail gating with state-aware fail evaluation while keeping recovery transition-based
- `apps/api/src/notifier/dispatch.test.ts` — added regression test for `fail -> fail` threshold crossing notification
**Decisions:** Recovery notifications remain transition-based (`fail -> success`) to avoid duplicate recoveries, but fail notifications now evaluate eligibility continuously for non-success states so threshold crossing cannot be missed.
**Deferred:** No additional API/UI changes; debugging remains via `notification_events` SQL queries.

## 2026-03-26 · F-07 · Set Default Cooldown to 24 Hours

**What was built:** Changed alert cooldown defaults to 24 hours and exposed cooldown editing in the test editor UI. Added a migration that updates every existing test's `cooldown_ms` to 24 hours and changes the DB default for future rows.
**Files changed:**
- `packages/shared/src/schemas.ts` — `CreateTestSchema.cooldown_ms` default changed from 5 minutes to `86_400_000`
- `apps/api/src/db/migrations/007_cooldown_24h.sql` (new) — sets table default and updates all existing test rows to 24h
- `apps/api/src/notifier/dispatch.ts` — fallback cooldown default changed to 24h
- `apps/web/app/tests/_components/test-editor.tsx` — added `Alert Cooldown (h)` input, validation, and request payload mapping to `cooldown_ms`
**Decisions:** Kept DB migration authoritative for existing data so behavior changes immediately and uniformly, while schema/UI defaults keep new and edited tests aligned.
**Deferred:** No dedicated cooldown display on dashboard/detail views yet.

---

## 2026-03-30 · F-23 Follow-up · Threshold-based public status

**What was built:** The public status page now uses `failure_threshold` to determine `current_status` instead of treating any failure as "down". A new `public_status` column on `test_state` is computed atomically during the `test_state` upsert (via a JOIN on `tests.failure_threshold`). The status API reads this pre-computed value directly — no per-request computation. A new "degraded" state is added: shown when `0 < consecutive_failures < failure_threshold`. Day-level outcomes are also fixed: mixed days (both successes and failures) are now "degraded" rather than "down".

**Files changed:**
- `apps/api/src/db/migrations/008_public_status.sql` (new) — adds `public_status` column to `test_state`
- `apps/api/src/db/result-buffer.ts` — upsert computes `public_status` via JOIN on `tests.failure_threshold`
- `packages/shared/src/types.ts` — added `'degraded'` to `PublicStatusOutcome`
- `apps/api/src/routes/status.ts` — reads `public_status` from `test_state`; `dayOutcome` fixed for mixed days
- `apps/web/app/status/_components/status-page-content.tsx` — `CurrentLabel` handles `'degraded'` (yellow)
- `apps/api/src/routes/status.test.ts` — updated for 3-query mock pattern and new status logic
- `apps/api/src/db/result-buffer.test.ts` — asserts `public_status` in upsert SQL

**Decisions:** Storing `public_status` in `test_state` rather than computing it on each status page request makes the route trivially fast (one indexed column read) and keeps the logic co-located with the state update. The JOIN on `tests` in the upsert is safe since `test_state` always references a live test.

**Deferred:** Existing `test_state` rows with no recorded runs keep `public_status = 'unknown'` (migration default) until their first run completes — correct behaviour.

## 2026-03-30 · UI · Expose missing test configurations in edit form and details page

**What was built:** Added `retries`, `failure_threshold`, and `uses_browser` fields to the test editor form (previously these existed in the DB and API but were never surfaced in the UI). Added a "Configuration" section to the test details page showing all test settings (interval, timeout, retries, failure threshold, alert cooldown, browser usage, enabled status, and tags) as a compact key-value grid.

**Files changed:**
- `apps/web/app/tests/_components/test-editor.tsx` — added state, validation, API body fields, and UI inputs for the three missing fields
- `apps/web/app/tests/[id]/page.tsx` — added Configuration section with `formatCooldown` inline helper

**Decisions:** No API or schema changes were needed — all fields were already accepted and returned. `formatCooldown` kept inline (not shared) since it's used in one place.

**Deferred:** Nothing.

## 2026-04-01 · F-24 · Incident lifecycle alignment

**What was built:** Incident reconstruction now uses the most recent runs window and a threshold-aware lifecycle policy, so incidents are not opened for isolated blips and are closed on recovery success. The `/tests/:id/incidents` endpoint now aligns with outage semantics already used by `test_state.public_status` and notifier thresholding.
**Files changed:**
- `apps/api/src/routes/tests.ts`
- `apps/api/src/routes/incident-policy.ts`
- `apps/api/src/routes/incident-policy.test.ts`
- `apps/api/src/routes/tests-incidents-route.test.ts`
- `docs/DOMAINS.md`
**Decisions:** Kept retries as documented-but-not-enforced behavior for now, and clarified docs instead of adding runtime retry orchestration in this change; timeout remains a failing signal for threshold streaks.
**Deferred:** Executor-level retry application (`tests.retries`) is still not implemented, so incident logic currently uses final status of each scheduled run attempt.
