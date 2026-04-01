# Sentinel

A lightweight synthetic testing and uptime monitoring platform for developers.

[![Test](https://github.com/territorial-dev/sentinel/actions/workflows/test.yml/badge.svg)](https://github.com/territorial-dev/sentinel/actions/workflows/test.yml)
![Coverage](.badges/coverage.svg)
[![Docker](https://img.shields.io/docker/v/paschendale/sentinel?label=docker)](https://hub.docker.com/r/paschendale/sentinel)

---

## What is Sentinel?

Sentinel lets you write synthetic tests as plain JavaScript functions that run on a schedule. It monitors whether your services, APIs, and business logic keep working — and alerts you when they don't.

**Key features:**

- Write tests as JavaScript with a simple `ctx` API
- Run tests every N seconds with configurable timeouts and retries
- Named assertions (`ctx.assert`) recorded per run
- State-transition alerts: notify on failure after a threshold, and again on recovery
- Notification channels: Discord, Slack, and generic webhooks
- Public read-only status pages (per-tag)
- Prometheus metrics endpoint
- Export and import all test definitions as JSON

---

## Deployment

### Docker Compose (recommended)

The easiest way to run Sentinel is with Docker Compose. Clone the repository and use the included `docker-compose.yml`:

```bash
curl -O https://raw.githubusercontent.com/paschendale/sentinel/main/docker-compose.yml
```

Edit the environment variables (see table below), then start:

```bash
docker compose up -d
```

Sentinel will be available at `http://localhost`. The API runs behind a Caddy reverse proxy — `/api/*` routes to the Fastify API, everything else to the Next.js dashboard.

### Cloudflare Deployment

If you want to host the dashboard on Cloudflare Pages and only run the API + database on a VPS, use `docker-compose.cloudflare.yml`:

```bash
curl -O https://raw.githubusercontent.com/paschendale/sentinel/main/docker-compose.cloudflare.yml
docker compose -f docker-compose.cloudflare.yml up -d
```

This starts only PostgreSQL and the Sentinel API (`paschendale/sentinel-api`) on port `3001`. Deploy the Next.js web app separately to Cloudflare Pages, pointing `NEXT_PUBLIC_API_URL` to your API's public URL.

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/sentinel` |
| `ADMIN_USERNAME` | Yes | Username for the single admin account |
| `ADMIN_PASSWORD` | Yes | Password for the admin account |
| `JWT_SECRET` | Yes | Secret used to sign JWT tokens — use a long random string |
| `PORT` | No | HTTP port for the API (default: `3001`; ignored in full-stack image which uses Caddy on port `80`) |
| `LOG_LEVEL` | No | Pino log level for the API process (`trace` … `fatal`; default: `info`) |
| `LOG_PRETTY` | No | When `true`, print human-readable lines instead of JSON (default: `true` except when `NODE_ENV=production`) |
| `NODE_ENV` | No | Set to `production` in deployment for JSON logs and `LOG_PRETTY` default off |

### Single Container (no Compose)

```bash
docker run -d \
  -e DATABASE_URL=postgres://user:pass@your-db-host:5432/sentinel \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=yourpassword \
  -e JWT_SECRET=your-random-secret \
  -p 80:80 \
  paschendale/sentinel:latest
```

PostgreSQL must be provisioned separately.

---

## Local Development

**Requirements:** Node.js 20+, pnpm 9+, PostgreSQL 16+

```bash
pnpm install
```

Create `apps/api/.env`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/sentinel
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
JWT_SECRET=dev-secret
# LOG_LEVEL=debug
# LOG_PRETTY=true   # readable test/HTTP lines in the API terminal (default on in dev)
```

Create `apps/web/.env.local`:

```env
API_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Run migrations and start:

```bash
pnpm migrate
pnpm dev
```

The API runs on `http://localhost:3001` and the dashboard on `http://localhost:3000`.

---

## Authentication

All API routes (except `/status`, `/metrics`) require a JWT.

**Login:**

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "yourpassword"}'
# → { "token": "eyJ..." }
```

Pass the token in all subsequent requests:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3001/tests
```

The web dashboard handles authentication automatically via a login page and a cookie.

---

## Writing Tests

Tests are JavaScript functions that receive a `ctx` object. Return a truthy value or throw to indicate pass/fail.

### The `ctx` API

#### `ctx.http` — HTTP client

```js
const res = await ctx.http.get('https://example.com/api/health')
// res.status   → number (e.g. 200)
// res.headers  → object
// res.body     → string (raw response body)
// res.json()   → parse body as JSON (throws if not valid JSON)

const res = await ctx.http.post('https://example.com/api/users', { name: 'Alice' }, {
  headers: { 'Content-Type': 'application/json' },
})
```

Supported methods: `get`, `post`, `put`, `delete`. All return `{ status, headers, body, json() }`.

`ctx.http` options:

- `headers` — request headers
- `timeout` — request timeout in milliseconds
- `redirect` — redirect policy: `'follow'` (default), `'manual'`, or `'error'`

**Redirect handling:**

Some endpoints (especially web UIs) can bounce between redirects and trigger a redirect-limit error.  
If you want to treat a redirect response as valid availability, use `redirect: 'manual'`:

```js
const res = await ctx.http.get('https://map.skyforest.se/v2/geoserver/web/', {
  redirect: 'manual',
})

ctx.assert('reachable', res.status >= 200 && res.status < 400)
```

When `redirect: 'follow'` is used and a redirect loop is detected, Sentinel throws `HttpRequestError` with code `HTTP_REDIRECT_ERROR`.

#### `ctx.assert(name, value, message?)` — Named assertions

Record individual assertion results attached to the test run:

```js
ctx.assert('status is 200', res.status === 200)
ctx.assert('body has id', res.json().id !== undefined, 'Expected id in response')
```

Assertions are stored in the database and shown on the test detail page. A failed assertion does not automatically fail the test — return a falsy value or throw to fail the run.

#### `ctx.log(...args)` — Logging

```js
ctx.log('Checking endpoint:', url)
ctx.log('Response:', res.status, res.body)
```

Logs are streamed to the browser when using the "Run Now" feature.

#### `ctx.now()` — Current timestamp

```js
const ts = ctx.now() // Returns a Date object
```

### Examples

**Simple HTTP uptime check:**

```js
const res = await ctx.http.get('https://example.com')
return res.status === 200
```

**JSON API assertion:**

```js
const res = await ctx.http.get('https://api.example.com/health')
ctx.assert('status ok', res.status === 200)
const body = res.json()
ctx.assert('service is up', body.status === 'ok')
return res.status === 200 && body.status === 'ok'
```

**Multi-step test:**

```js
// Create a user
const create = await ctx.http.post('https://api.example.com/users', {
  name: 'Test User',
}, { headers: { 'Content-Type': 'application/json' } })
ctx.assert('user created', create.status === 201)

// Fetch it back
const created = create.json()
const fetch = await ctx.http.get(`https://api.example.com/users/${created.id}`)
ctx.assert('user exists', fetch.status === 200)
ctx.assert('name matches', fetch.json().name === 'Test User')

return create.status === 201 && fetch.status === 200
```

### Scheduling & Timeouts

When creating a test, configure:

| Field | Description | Default |
|---|---|---|
| `schedule_ms` | How often the test runs, in milliseconds | 60000 (1 min) |
| `timeout_ms` | Max execution time before the run is marked as `timeout` | 10000 (10 s) |
| `retries` | Number of retry attempts on failure before recording a fail | 0 |
| `failure_threshold` | Consecutive failures before a notification is sent | 3 |
| `cooldown_ms` | Minimum time between repeat failure notifications | 300000 (5 min) |

---

## Notification Channels

Sentinel sends alerts on state transitions: when a test starts failing (after `failure_threshold` consecutive failures) and when it recovers.

**Supported channel types:** Discord webhook, Slack webhook, generic webhook.

### Setup

1. Go to the **Channels** page in the dashboard.
2. Create a channel with a name and webhook URL.
3. Assign channels to tests (per-test) or to tags (all tests with that tag inherit the channel).

### Alert payloads

- **Failure alert** — includes test name, failure reason, last response time, and how many consecutive failures occurred.
- **Recovery alert** — includes test name, downtime duration since the first failure, and last response time.

Discord alerts use colored embeds (red for failure, green for recovery). Slack alerts use attachments. Generic webhooks receive a JSON payload.

---

## Public Status Pages

Every test can be tagged. Tags power group-level public status pages — no authentication required.

- `/status` — overview of all tests with current status and 30-day uptime
- `/status/[tag]` — filtered status page for a specific tag (e.g. `/status/production`)

Each status page shows:
- Current status (up/down/unknown)
- 30-day uptime percentage
- 30-day daily history bar (green/red/gray per day)

Status pages are server-rendered with 5-minute ISR revalidation. They only query pre-aggregated `uptime_daily` data — never raw test runs.

---

## Prometheus Metrics

Sentinel exposes a Prometheus-compatible metrics endpoint at `GET /metrics` (no authentication required).

| Metric | Type | Description |
|---|---|---|
| `sentinel_check_duration_ms` | Histogram | Execution duration per test run |
| `sentinel_check_failures_total` | Counter | Total failed test runs |
| `sentinel_check_success_total` | Counter | Total successful test runs |

---

## Exporting and Importing Tests

Sentinel supports exporting all test definitions to JSON and importing them back. This is useful for backups, migrations between environments, or seeding a fresh instance.

### Export

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/tests/export
```

Returns a JSON object with a `tests` array. Each entry contains all test fields except `id`, `created_at`, and `updated_at`, making it directly importable.

```json
{
  "tests": [
    {
      "name": "Homepage check",
      "code": "return (await ctx.http.get('https://example.com')).status === 200",
      "schedule_ms": 60000,
      "timeout_ms": 5000,
      "retries": 0,
      "uses_browser": false,
      "enabled": true,
      "failure_threshold": 3,
      "cooldown_ms": 300000,
      "tags": ["web", "critical"]
    }
  ]
}
```

### Import

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d @export.json \
  http://localhost:3001/tests/import
```

Each test in the array is validated. If any entry is invalid the entire request is rejected with a `400` and a per-index error map — no tests are created. On success, all tests are inserted atomically and the scheduler picks them up immediately.

**Round-trip backup example:**

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

> Note: notification channels are not included in the export. They must be reconfigured separately.

---

## Internal Docs

- [Product Overview](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Domain Model](docs/DOMAINS.md)
- [Repository Structure](docs/REPOSITORY.md)
