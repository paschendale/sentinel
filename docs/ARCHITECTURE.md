# Sentinel — Architecture

## Guiding Constraint

The entire architecture is driven by a single deployment target: **1GB RAM, 0.5 vCPU**. Every decision below exists to make that work sustainably at ~500 tests/minute.

---

## Repository Layout

```
sentinel/
├── apps/
│   ├── api/       # Fastify API + scheduler + executor + notifier
│   └── web/       # Next.js frontend
├── packages/
│   └── shared/    # Shared TypeScript types + Zod schemas
└── docs/
```

pnpm workspaces manage the monorepo.

---

## Backend (`apps/api`)

### Runtime
- **Node.js + TypeScript** — async event loop, no multi-threading
- Single process, no worker threads (prevents memory fragmentation)
- `tsx` for development, compiled JS for production

### HTTP Layer
- **Fastify** — minimal overhead (~0.5MB vs Express), schema-based validation
- JSON schema on all routes for free input validation

### Database
- **PostgreSQL** via `pg` (raw SQL only — no ORM, no query builder)
- Connection pool: max **5 connections**
- **Batch writes**: results buffered and flushed every 1–2 seconds in batches of 50–100
- **Time-partitioned tables**: `test_runs_YYYY_MM` — daily maintenance also ensures current+future partitions exist
- **UptimeDaily**: pre-aggregated stats written once per day per test — public dashboards never query raw `test_runs`
- Retention: raw runs default 7 days (`RAW_RETENTION_DAYS`, exact cutoff, batched deletes), aggregated daily stats default 90 days (`AGG_RETENTION_DAYS`), prune batch size via `PRUNE_BATCH_SIZE`

### Outbound HTTP (test execution)
- **Undici** — connection pooling per hostname, reuse across tests hitting the same origin
- Never Axios, never `node-fetch`

### Concurrency Control
- **p-limit** — concurrency cap of 5–10 slots for HTTP tests
- **Separate queue** for Playwright browser tests: max 1 concurrent
- **Backpressure**: if queue is full, skip the check and log — never queue unboundedly

### Scheduler
- `setInterval`-based — one interval per test, registered on startup
- **Jitter**: each test fires at `interval + random(0, interval * 0.1)` to prevent thundering herd
- No cron libraries (too heavy for simple interval scheduling)

### Test Execution Engine
- User test code compiled **once on save** via `new Function('ctx', code)` and cached in memory
- Execution: `Promise.race([compiledFn(ctx), timeout(ms)])` — hard kill after timeout
- `ctx` object exposes only: `ctx.http`, `ctx.ftp`, `ctx.s3`, `ctx.secrets`, `ctx.assert`, `ctx.warn`, `ctx.log`, `ctx.now()`
- `ctx.s3.get`/`ctx.s3.head` sign requests with AWS Signature Version 4, hand-rolled via `node:crypto` — no AWS SDK dependency, works against any S3-compatible endpoint since signing only depends on the request URL
- No filesystem access from user code — `ctx.ftp.get` and `ctx.s3.get` both download to the same server-managed temp file mechanism internally (same directory, same size cap, same periodic sweep), but user code only ever sees the returned string body, never a path
- Tests must return a boolean (`true` = pass, `false`/throw = fail)

### Secret Store
- Global, write-only key-value store for credentials referenced in test code as `ctx.secrets.NAME` — keeps API keys out of `tests.code` and the Monaco editor history
- Values encrypted at rest with AES-256-GCM (`node:crypto`, no new dependency) under an **optional** `SECRETS_ENCRYPTION_KEY` env var — optional because a newly-required env var would break existing deployments on upgrade; if unset, values are stored unencrypted and the `/secrets` dashboard page shows a warning banner
- Stored as a version-tagged blob (mode byte + payload) so plaintext and encrypted secrets coexist across a key being configured later; secrets aren't bulk re-encrypted when the key changes — only on individual rotation
- Decrypted once into an in-memory cache at startup (`apps/api/src/executor/secrets-cache.ts`), refreshed synchronously on every create/rotate/delete — `ctx.secrets` is a synchronous object read with no DB query or crypto on the test-execution hot path, mirroring how compiled test functions are cached rather than recompiled per run
- A single undecryptable secret (e.g. the key was changed after that secret was encrypted) is logged and excluded from the cache rather than crashing the process — one bad secret must never take the whole scheduler down

### Notification Pipeline
- Event-driven: `testFailed → notifier → channels`
- **Fire-and-forget**: notifications never block the test execution path
- State tracked per test: `lastStatus`, `consecutiveFailures`, `lastNotificationAt`, `lastWarningAt`
- Three event types: **warning** (`warn` result), **fail** (threshold crossed), **recovery** (back to success)
- Fail alert only after **3 consecutive failures** (configurable `failure_threshold`)
- Warning alert fires on first `warn` result — no threshold, just cooldown
- `lastNotificationAt` and `lastWarningAt` are tracked independently so a warning never suppresses a subsequent fail alert
- Channel routing is filterable per event type: each `channel_assignments` row carries an `event_types` array, and the channel-selection query filters on the event type already resolved above — so a single test can route `warning` to one channel and `fail` to another without needing separate tests per event type

### Observability
- **Pino** for structured JSON logging — logs are the primary operational output
- **prom-client**: exposes `/metrics` with `check_duration_ms`, `check_failures_total`, `check_success_rate`

---

## Frontend (`apps/web`)

### Framework
- **Next.js** with App Router — kept minimal
- Server Components for all data-fetching pages (zero client JS where possible)
- Client Components only where interactivity is required (code editor, run button)

### Key UI Areas
- **Dashboard**: test list with last status, last run time, 7-day sparkline
- **Test editor**: Monaco Editor (lazy-loaded, not bundled eagerly) for JS code editing
- **Test detail**: recent runs, pass/fail history, duration chart
- **Public status page**: SSG/ISR from `UptimeDaily` only — never queries raw `test_runs`

### Design System

**Aesthetic:** Apple-like — minimal, calm, purposeful. Every pixel earns its place. No decoration, no chrome, no noise.

**Principles:**
- Negative space is a design element — use it aggressively
- Typography does the work (size + weight hierarchy) — not color
- One primary action per screen. Secondary actions recede.
- Status is communicated via color AND shape (never color alone)
- Animations: opacity transitions only, 150ms max. No slide-ins. No bounce.
- Borders are nearly invisible or absent — surfaces differ by background luminance only
- Error states are calm and specific, not alarming

**Theme:**
- **Dark mode by default** — `dark` class on `<html>`, no system-preference toggle needed for MVP
- Background scale: `zinc-950` (page) → `zinc-900` (card) → `zinc-800` (input/hover)
- Text: `zinc-100` primary, `zinc-400` secondary/muted, `zinc-600` disabled
- Accent: `emerald-500` for success/pass, `yellow-400` for warn/degraded, `red-500` for failure, `zinc-500` for neutral/unknown
- Font family: **Consolas, monospace** — used for both UI text and code. Do not mix with a sans-serif UI font.

**Components:** Use **shadcn/ui** (Radix UI headless primitives + Tailwind). Install components individually with `npx shadcn@latest add <component>`. Never wrap shadcn components in additional abstraction layers — edit the generated component file directly if customization is needed.

### Bundle discipline
- Monaco and **Recharts** are large client-side dependencies — both must be **dynamically imported** (`ssr: false`) where used
- No heavy UI libraries (no MUI, no Chakra, no Ant Design)
- shadcn/ui components are code-owned (not a runtime package) — acceptable
- Public status pages must load fast — no client-side data fetching

---

## Shared Package (`packages/shared`)

- TypeScript interfaces: `Test`, `TestRun`, `AssertionResult`, `UptimeDaily`, `NotificationChannel`, `TestState`
- Zod schemas for API input validation (shared between API and web)
- No runtime dependencies beyond `zod`

---

## Approved Dependencies

### Backend (`apps/api`)
| Package | Purpose |
|---------|---------|
| `fastify` | HTTP API server |
| `basic-ftp` | FTP client for `ctx.ftp` probes (zero runtime deps, no native bindings) |
| `undici` | Outbound HTTP with connection pooling |
| `pg` | PostgreSQL client |
| `p-limit` | Concurrency control |
| `p-timeout` | Promise timeout enforcement |
| `pino` | Structured logging |
| `pino-pretty` | `devDependency` — readable terminal output when `LOG_PRETTY` is on |
| `prom-client` | Prometheus metrics |
| `nanoid` | ID generation |
| `zod` | Schema validation (shared) |

### Frontend (`apps/web`)
| Package | Purpose |
|---------|---------|
| `next` | Framework |
| `react` / `react-dom` | UI |
| `tailwindcss` | Utility-first styling |
| `@radix-ui/*` | Headless UI primitives (via shadcn) |
| `class-variance-authority` | Variant styling for shadcn components |
| `clsx` + `tailwind-merge` | Class merging utilities |
| `lucide-react` | Icon set (used by shadcn) |
| `@monaco-editor/react` | Code editor (lazy-loaded) |
| `recharts` | Internal charts (e.g. test detail latency; lazy-loaded) |
| `zod` | Schema validation (shared) |

**Explicitly banned**: `axios`, `express`, `redis`, `bullmq`, `prisma`, `typeorm`, `sequelize`, `lodash`, `moment`, `@mui/material`, `@chakra-ui/react`, `antd`, `styled-components`

---

## Data Flow

```
[Scheduler] → schedules test at interval+jitter
     ↓
[Executor] → compiles fn, runs with ctx, enforces timeout
     ↓
[Result] → buffered in memory
     ↓
[DB Writer] → batch flush every 1-2s to test_runs + assertion_results
     ↓
[Aggregator] → daily job updates uptime_daily
     ↓
[Notifier] → checks state transition → fires webhook (fire-and-forget)
```

---

## Hard Rules

1. **Event loop must never block** — no sync I/O, no heavy CPU in hot paths
2. **Raw SQL only** — no ORM, no query builder
3. **Batch DB writes** — never `INSERT` individual rows in a loop
4. **Notifications are fire-and-forget** — never `await` a notification in the test path
5. **Playwright is opt-in** — never imported unless the test sets `uses_browser: true`
6. **Public dashboards read only from `UptimeDaily`** — never from raw `test_runs`
7. **No new dependencies** without checking this file's approved list
