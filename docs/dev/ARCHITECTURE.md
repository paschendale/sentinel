# Architecture

Everything here follows from one deployment target: **1 GB RAM, 0.5 vCPU**, running about 500 tests a minute. Read this before changing `apps/api/src/executor/`, `scheduler/` or `db/`.

## Repository

A pnpm monorepo: two apps and one shared package.

```
sentinel/
├── apps/
│   ├── api/                      Fastify API, scheduler, executor, notifier (one process)
│   │   ├── Dockerfile            API-only image (paschendale/sentinel-api)
│   │   └── src/
│   │       ├── index.ts          Entry: migrate, warm caches, start scheduler, flusher, jobs, server
│   │       ├── config.ts         Every environment variable, read once
│   │       ├── server.ts         Fastify setup, auth hook, error handler, route registration
│   │       ├── version.ts        Release version (root package.json or the image's VERSION file)
│   │       ├── outbound-headers.ts  User-Agent and X-Sentinel-Instance on outbound requests
│   │       ├── auth/             JWT sign/verify, request principal (person or token)
│   │       ├── crypto/           AES-256-GCM cipher for secrets and bot tokens
│   │       ├── db/
│   │       │   ├── migrations/   Plain SQL, applied in name order at startup
│   │       │   ├── queries/      Raw SQL per entity
│   │       │   ├── result-buffer.ts  Batched run writes, state upsert, incident open/resolve
│   │       │   └── aggregator.ts Daily uptime aggregation, pruning, partitions
│   │       ├── executor/         compile, ctx (http, ftp, s3, k8s), run, run-now, secrets cache, temp sweep
│   │       ├── scheduler/        Per-test timers, concurrency limit, overlap guard
│   │       ├── notifier/         Gating, payloads, webhook/email delivery, bot threads, reconciler
│   │       ├── routes/           REST routes, public cache, error shape, MCP endpoint
│   │       ├── mcp/tools.ts      MCP tool definitions (wrap the REST routes)
│   │       ├── metrics/          prom-client registry
│   │       └── tags/             Tag normalisation
│   └── web/                      Next.js App Router
│       ├── app/
│       │   ├── (public)/         /, /status, /status/[slug], /status/tests/[id], /status/incidents/[id]
│       │   ├── admin/            /admin sign-in, signout route, (app)/ for every signed-in page
│       │   ├── _components/ui/   The component library (see DESIGN.md)
│       │   └── styles/           tokens.css (values a fork edits), components.css (sn-* classes)
│       ├── lib/                  API clients, auth cookie, formatting, state words, theme
│       ├── assets/Logos/         The Beacon mark
│       └── middleware.ts         Gates /admin/* on the session cookie
├── packages/shared/              Types, zod schemas, state rules and labels (API and web)
├── docs/                         guide/, reference/, dev/, FORKING.md
├── Dockerfile                    Full image (paschendale/sentinel): API + web + Caddy
├── docker-compose*.yml, Caddyfile, docker-entrypoint.sh
└── CONTRIBUTING.md, ROADMAP.md, CHANGELOG.md
```

Cross-package imports use `"@sentinel/shared": "workspace:*"`. Inside `apps/api/src` there are no barrel files; import from the source file.

## API process

One Node.js process, no worker threads. `tsx` in development, compiled JS in production.

### Startup

`index.ts` runs the migrations (retrying the first connection), loads the compiled-code and secrets caches (one bad row is logged and skipped, never fatal), registers every enabled test with the scheduler, then starts the result flusher, the aggregator, the FTP temp sweep, the reconciler and the HTTP server. On shutdown it stops the scheduler and waits for an in-flight flush.

### HTTP

Fastify. A global `onRequest` hook checks the bearer JWT on everything except `POST /auth/login` and `GET /status*`, `/metrics`, `/health`. Every error goes through one handler and returns `{ error, details? }`. CORS allows the web origin. See the [API reference](../reference/api.md).

### Database

- PostgreSQL through `pg`, raw SQL only, pool of at most 5 connections.
- `test_runs` is partitioned by month; the aggregator keeps current and next partitions ready.
- **Batched writes.** Results go into an in-memory buffer, flushed every 2 s or at 100 rows, in chunks of 100, one transaction per chunk. A chunk that fails on data isolates the bad row and drops it (logged); only connection errors requeue. The buffer holds at most 5000 rows and drops the oldest beyond that.
- **State in the same transaction.** The flush upserts `test_state` (last status, failure streak, public status, problem window) and returns each test's transition, then opens, joins or resolves incidents in the same transaction.
- **Daily aggregation** at 00:00 UTC into `uptime_daily` (success, warn and failure counts, average latency), then pruning by retention. See [deployment](../guide/deployment.md#retention-and-background-jobs).
- **Migrations** are numbered SQL files applied in name order and recorded by name in `schema_migrations`. Upstream uses `001` to `899`; `900` to `999` is reserved for forks ([FORKING.md](../FORKING.md)).

### Scheduler

- One `setTimeout` chain per enabled test. The interval gets up to 10% jitter so tests with the same interval drift apart.
- The first delay comes from `test_state.last_run_at`, so a restart or an edit keeps a test's phase; overdue and never-run tests start within the first minute, spread out.
- `p-limit` caps concurrency at 10 runs. When all slots are busy the tick is skipped and logged, never queued.
- An overlap guard skips a tick while the previous run of the same test is still in flight. `timeout_ms <= 0.8 × schedule_ms` (zod and a Postgres `CHECK`) makes that rare.
- No cron library.

### Executor

- Code is compiled once on save with `new Function('ctx', code)` and cached. `POST`/`PATCH /tests` reject code that does not compile with 400; stored code that no longer compiles records a Failed run.
- A run is `Promise.race` between the function and the test's `timeout_ms`. On timeout the run's `AbortController` aborts every pending `ctx` call and the run records `timeout` with the pending calls named in `error_message`.
- A run fails when the function throws (a failed `ctx.assert` throws) or returns exactly `false`. `ctx.warn` without a failure makes it `warn`.
- `ctx` exposes only `http`, `ftp`, `s3`, `k8s`, `secrets`, `assert`, `warn`, `log`, `now`. No filesystem, no `require`, no `process`.
- Outbound HTTP uses undici with per-origin pooling. Bodies are read as streams with a size cap (`FTP_MAX_DOWNLOAD_BYTES`); FTP and S3 downloads stream to a temp file that is deleted before the call returns.
- S3 requests are signed with SigV4 in `node:crypto`; `ctx.s3.list` parses ListObjectsV2 XML with regexes. Kubernetes reads pin an optional CA through a cached undici `Agent`. No SDKs.
- `ctx.secrets` is a frozen object from an in-memory cache, decrypted at startup and refreshed on every write, so a run never queries the database or decrypts.
- Retries: scheduled runs re-run a failed or timed-out attempt up to `retries` times while a full attempt still fits in 80% of `schedule_ms`; one result is recorded. Manual runs (`runNow`, used by the REST route, the SSE stream and MCP) make one attempt and refuse to start while a run of the same test is in flight.

The full `ctx` contract is in [Writing tests](../guide/writing-tests.md).

### Notifier

- Fed by the flush with each test's transition; never awaited by the test path, and every delivery is wrapped so a failure is logged, not thrown.
- Gating: a `fail` event once consecutive failures reach `failure_threshold` and the cooldown has passed; a `warning` event on the first warned run, then per cooldown, tracked separately; `recovery` when a test passes after an alert. Only state changes notify.
- Channels resolve from direct and tag assignments, filtered by each assignment's event types.
- Webhook and email channels get one message per event (`payloads.ts`). Bot channels (`discord_bot`, `slack_bot`) go through `incidents.ts`: one root message per incident, edited on state change and recovery, with updates in a thread; transports live behind one `IncidentTransport` interface.
- Every request has a 10 s timeout and its response body is consumed; candidates are delivered concurrently, so one hung webhook does not hold up the rest.
- `notification_events` logs deliveries and due-but-undelivered alerts, batched.
- The reconciler (every 5 min) retries thread closes and resolves incidents whose tests are all Operational.

Details for users: [Notifications](../guide/notifications.md).

### Public routes

`GET /status*` serve the status page without auth. They sit behind an in-process cache (`routes/public-cache.ts`): 30 s per key, at most 500 keys, concurrent misses share one load. Parameters are validated (bad input is a 400) and bounded. The 30-day view reads `uptime_daily`; the 1 h, 24 h and 7 d views read `test_runs` through the indexed `started_at`, at most once per key per 30 s. Public responses never carry error messages, code or internal incident text.

### MCP server

`POST /mcp` speaks MCP Streamable HTTP in stateless mode through `@modelcontextprotocol/sdk` (subpath imports only; the SDK's optional `express` dependency is never loaded). Each request builds a fresh server. The 29 tools in `mcp/tools.ts` call the REST routes in-process with `app.inject()`, so validation, events and error mapping are shared; `run_test_now` calls `runNow()` to collect logs. The server's `instructions` (in `routes/mcp.ts`) and the tool descriptions are the only documentation an agent sees, so they change with every capability change ([CONTRIBUTING.md](../../CONTRIBUTING.md#the-mcp-text-rule)).

Auth is the same bearer JWT. Tokens from `POST /auth/mcp-token` carry `sub: 'mcp'`; the request principal treats them as a token, not a person, and the publish routes return 403 to them. There is no per-token revocation.

### Observability

Pino JSON logs with an `event` field on every line that matters; `LOG_PRETTY` for terminals. `prom-client` metrics at `/metrics`. `/health` checks the database.

## Web app

- Next.js App Router, Server Components by default; Client Components only for interaction (editor, run console, forms, bulk bar, theme switch).
- Public pages render per request and refresh every 60 s in the browser; the API's cache absorbs the load. Signed-in pages fetch with the session cookie's token and show an outage callout when the API request fails.
- Styling: CSS variables from `styles/tokens.css` (dark on `:root`, light by OS preference or `data-theme`), component classes in `styles/components.css`, and a Tailwind theme that knows only the tokens. A boot script applies the stored theme before paint.
- Fonts through `next/font/google` (Inconsolata for interface, Inter for prose), self-hosted at build.
- Monaco and Recharts are dynamically imported with `ssr: false`.
- Incident report Markdown is rendered by a small hand-written subset (paragraphs, lists, links, inline code).

See [DESIGN.md](DESIGN.md) for the rules and components.

## Shared package

`packages/shared` holds the types, the zod schemas used by both apps, and the rules that must agree everywhere: `state.ts` (what a run result means, `publicStatusFor`, uptime, the label maps from wire values to words, durations), `sections.ts` (which section a test is in and its order) and `incidents.ts`. Its only runtime dependency is `zod`.

## Data flow

```
Scheduler ── timer + jitter, concurrency 10, overlap guard
   │
Executor ── compiled fn + ctx, Promise.race with timeout_ms, abort pending I/O
   │
Result buffer ── every 2 s / 100 rows, chunked transactions
   │   ├─ test_runs + assertion_results
   │   ├─ test_state upsert → transitions
   │   └─ incidents open / join / resolve
   │
Notifier ── gating → webhook, email, bot threads (fire and forget)
   │
Aggregator ── 00:00 UTC → uptime_daily, pruning, partitions
```

## Dependencies

The list is short on purpose. Adding one needs a reason a few lines of code cannot meet, and no native bindings.

| Package | App | Purpose |
| --- | --- | --- |
| `fastify` | api | HTTP server |
| `@modelcontextprotocol/sdk` | api | MCP over Streamable HTTP |
| `pg` | api | PostgreSQL |
| `undici` | api | Outbound HTTP with pooling (tests, notifier, bots) |
| `basic-ftp` | api | `ctx.ftp` (no runtime deps, no native code) |
| `p-limit` | api | Concurrency limit (scheduler, notifier) |
| `pino` | api | Logging (`pino-pretty` is a dev dependency) |
| `prom-client` | api | Metrics |
| `nanoid` | api | IDs |
| `zod` | all | Validation |
| `next`, `react`, `react-dom` | web | Framework |
| `@monaco-editor/react` | web | Code editor (lazy) |
| `recharts` | web | Latency chart (lazy) |
| `@radix-ui/react-alert-dialog` | web | Accessible dialog behind the Dialog component |
| `clsx` | web | Class names |
| `tailwindcss`, `postcss`, `autoprefixer` | web (dev) | Build-time CSS |

Development: `typescript`, `tsx`, `vitest` with `@vitest/coverage-v8`, semantic-release and its plugins.

Banned: `axios`, `express` (as a direct dependency), `redis`, `bullmq`, `prisma`, `typeorm`, `sequelize`, `knex`, `drizzle`, `lodash`, `moment`, `@mui/material`, `@chakra-ui/react`, `antd`, `styled-components`, any UI kit.
