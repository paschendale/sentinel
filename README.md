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
- Three-tier outcomes: **pass** (green), **warn** (yellow/degraded), **fail** (red)
- State-transition alerts: failure, warning (degraded), and recovery notifications
- Notification channels: Discord, Slack, and generic webhooks
- Encrypted secret store — read via `ctx.secrets.NAME` in test code, values are write-only after creation
- Public read-only status pages (per-tag)
- Prometheus metrics endpoint
- Export and import all test definitions as JSON

---

## Deployment

### Docker Compose (recommended)

The easiest way to run Sentinel is with Docker Compose. Clone the repository and use the included `docker-compose.yml`:

```bash
curl -O https://raw.githubusercontent.com/territorial-dev/sentinel/main/docker-compose.yml
```

Edit the environment variables (see table below), then start:

```bash
docker compose up -d
```

Sentinel will be available at `http://localhost`. The API runs behind a Caddy reverse proxy — `/api/*` routes to the Fastify API, everything else to the Next.js dashboard.

### Cloudflare Deployment

If you want to host the dashboard on Cloudflare Pages and only run the API + database on a VPS, use `docker-compose.cloudflare.yml`:

```bash
curl -O https://raw.githubusercontent.com/territorial-dev/sentinel/main/docker-compose.cloudflare.yml
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
| `FTP_TEMP_DIR` | No | Directory `ctx.ftp.get` and `ctx.s3.get` write temp downloads to (default: OS temp dir + `sentinel-ftp`) |
| `FTP_MAX_DOWNLOAD_BYTES` | No | Max bytes `ctx.ftp.get` or `ctx.s3.get` will download before aborting (default: `5242880`, 5MB) |
| `SECRETS_ENCRYPTION_KEY` | No | Base64-encoded 32-byte AES-256-GCM key for encrypting `ctx.secrets` values at rest (generate with `openssl rand -base64 32`). If unset, secrets are stored **unencrypted** — `ctx.secrets` still works, but the dashboard shows a warning banner |

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

#### `ctx.ftp` — FTP client

```js
const entries = await ctx.ftp.ls('ftp://user:pass@ftp.example.com/incoming')
ctx.assert('has files', entries.length > 0)

const file = await ctx.ftp.get('ftp://user:pass@ftp.example.com/incoming/daily.csv')
// file.body → string (file contents, decoded as utf-8)
// file.size → number (bytes)
ctx.assert('file not empty', file.size > 0)
```

`ctx.ftp.ls(url, options?)` returns `{ name, type, size, modifiedAt }[]` for the directory at `url`. `ctx.ftp.get(url, options?)` downloads a file and returns `{ body, size }`.

`ctx.ftp` options:

- `user` / `password` — override credentials embedded in the URL (defaults: `anonymous` / `guest`)
- `secure` — use FTPS (explicit TLS), default `false`
- `timeout` — connection socket timeout in milliseconds, defaults to the test's own `timeout_ms`

**Downloads are never persisted.** `ctx.ftp.get` streams the remote file into a server-managed temp file, reads it into memory, and deletes it before the call returns — your test only ever sees the string `body`, never a path. Downloads larger than `FTP_MAX_DOWNLOAD_BYTES` (default 5MB) are aborted with an `FTP_SIZE_LIMIT_ERROR`. A periodic background sweep also removes any leftover temp file older than 15 minutes, as a backstop for crashes or timed-out runs.

#### `ctx.s3` — S3 client (built-in SigV4 signing)

```js
const res = await ctx.s3.get('https://examplebucket.s3.us-east-1.amazonaws.com/test.txt', {
  accessKey: ctx.secrets.S3_ACCESS_KEY,
  secretKey: ctx.secrets.S3_SECRET_KEY,
  region: 'us-east-1',
})
ctx.assert('object exists', res.status === 200)

const head = await ctx.s3.head('https://examplebucket.s3.us-east-1.amazonaws.com/test.txt', {
  accessKey: ctx.secrets.S3_ACCESS_KEY,
  secretKey: ctx.secrets.S3_SECRET_KEY,
  region: 'us-east-1',
})
ctx.assert('object metadata reachable', head.status === 200)
```

`ctx.s3.get(url, options)` downloads an object; `ctx.s3.head(url, options)` checks existence/metadata without downloading the body. Both sign the request with AWS Signature Version 4 — implemented directly with `node:crypto`, no AWS SDK — and return the same `{ status, body, headers, json() }` shape as `ctx.http`.

`ctx.s3` options:

- `accessKey` / `secretKey` — required credentials used to sign the request
- `region` — required, must match the bucket's actual region (used in the SigV4 credential scope)
- `sessionToken` — optional, for temporary/STS credentials
- `headers` — optional extra headers (e.g. `Range: bytes=0-9`); these are included in the signature

Like any other credential, store `accessKey`/`secretKey` as [secrets](#secrets) and read them via `ctx.secrets.NAME` rather than hardcoding them in test code, exactly as shown above. `url` can be virtual-hosted-style, path-style, or any S3-compatible endpoint (MinIO, Cloudflare R2, etc.) — signing only depends on the request's host, path, and query string, so nothing AWS-specific is required beyond the four SigV4 inputs. Failures throw `S3RequestError` with `code: 'S3_SIGNING_ERROR'` (malformed URL), `code: 'S3_FETCH_ERROR'` (the request itself failed), or, for `get`, `code: 'S3_SIZE_LIMIT_ERROR'` (see below).

**Downloads are never persisted.** Like `ctx.ftp.get`, `ctx.s3.get` streams the object into the same server-managed temp directory (`FTP_TEMP_DIR`), reads it into memory, and deletes it before the call returns — your test only ever sees the string `body`, never a path, and nothing is left behind on disk. Downloads larger than `FTP_MAX_DOWNLOAD_BYTES` (default 5MB, shared with `ctx.ftp.get`) abort the request mid-transfer with an `S3_SIZE_LIMIT_ERROR`. The same periodic background sweep that backstops `ctx.ftp.get` also covers `ctx.s3.get`, since both write into the same directory — orphaned temp files from a crash or timed-out run are removed after 15 minutes either way. `ctx.s3.head` never downloads a body, so it has nothing to clean up.

#### `ctx.secrets` — Encrypted secret access

Reference values registered on the [Secrets page](#secrets) instead of hardcoding API keys or credentials in test code:

```js
const res = await ctx.http.get('https://api.example.com/health', {
  headers: { Authorization: `Bearer ${ctx.secrets.API_KEY}` },
})
ctx.assert('authenticated', res.status === 200)
return res.status === 200
```

`ctx.secrets` is a plain object, not a function — `ctx.secrets.SECRET_NAME` reads the value directly. If a secret with that name doesn't exist (or couldn't be decrypted — see [Secrets](#secrets)), the property is simply `undefined`, same as accessing a missing key on any object. Secrets are shared across all tests; there's no per-test scoping.

#### `ctx.assert(name, value, message?)` — Named assertions

Record individual assertion results attached to the test run:

```js
ctx.assert('status is 200', res.status === 200)
ctx.assert('body has id', res.json().id !== undefined, 'Expected id in response')
```

Assertions are stored in the database and shown on the test detail page. A failed assertion throws immediately and fails the run.

#### `ctx.warn(message)` — Degraded / warning state

Signal that something is off without failing the run:

```js
ctx.warn(`data is stale: ${Math.round(ageMinutes)} min`)
```

The run completes with status `warn` (yellow) instead of `success`. The test is not considered down — `consecutive_failures` is not incremented — but `public_status` becomes `degraded` and a **warning notification** is sent to all assigned channels (subject to the test's cooldown). When the test later passes cleanly, a recovery notification fires.

This is useful for soft thresholds, data freshness checks, or anything that degrades before it fully breaks:

```js
if (ageMinutes >= 180) {
  throw new Error(`CRITICAL: stale ${Math.round(ageMinutes)} min`)
}
if (ageMinutes >= 60) {
  ctx.warn(`stale ${Math.round(ageMinutes)} min`)
}
return true
```

#### `ctx.log(message)` — Logging

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

**FTP directory listing:**

```js
const entries = await ctx.ftp.ls('ftp://demo:password@test.rebex.net/')
ctx.log(`Found ${entries.length} entries`)
for (const e of entries) { ctx.log(`${e.type} ${e.name} (${e.size} bytes)`) }
ctx.assert('has entries', entries.length > 0)
return entries.length > 0
```

**FTP file download and check:**

```js
const file = await ctx.ftp.get('ftp://demo:password@test.rebex.net/readme.txt')
ctx.log(`Downloaded ${file.size} bytes`)
ctx.assert('file not empty', file.size > 0)
ctx.assert('body is string', typeof file.body === 'string')
return file.size > 0
```

**FTP error handling:**

```js
let caught = null
try {
  await ctx.ftp.get('ftp://demo:password@test.rebex.net/does-not-exist.txt')
} catch (err) {
  caught = err
}
ctx.log(`caught: ${caught ? caught.code : 'nothing'}`)
ctx.assert('error was thrown', caught !== null)
ctx.assert('error code is FTP_DOWNLOAD_ERROR', caught && caught.code === 'FTP_DOWNLOAD_ERROR')
return caught !== null && caught.code === 'FTP_DOWNLOAD_ERROR'
```

All three examples above run as-is against [test.rebex.net](https://test.rebex.net), a public read-only FTP server Rebex maintains specifically for testing FTP clients — useful for trying out `ctx.ftp` before pointing it at your own server.

**S3 object download:**

```js
const res = await ctx.s3.get('https://examplebucket.s3.us-east-1.amazonaws.com/hello.txt', {
  accessKey: ctx.secrets.S3_ACCESS_KEY,
  secretKey: ctx.secrets.S3_SECRET_KEY,
  region: 'us-east-1',
})
ctx.log(`status=${res.status} body=${res.body}`)
ctx.assert('status is 200', res.status === 200)
ctx.assert('body not empty', res.body.length > 0)
return res.status === 200
```

**S3 existence check (HEAD, no body downloaded):**

```js
const res = await ctx.s3.head('https://examplebucket.s3.us-east-1.amazonaws.com/hello.txt', {
  accessKey: ctx.secrets.S3_ACCESS_KEY,
  secretKey: ctx.secrets.S3_SECRET_KEY,
  region: 'us-east-1',
})
ctx.log(`HEAD status=${res.status} content-length=${res.headers['content-length']}`)
ctx.assert('object exists', res.status === 200)
return res.status === 200
```

Unlike `ctx.ftp`, there's no public server you can point these at anonymously — SigV4 requires real credentials tied to an account, and S3 rejects a request carrying an invalid `Authorization` header even for objects that are otherwise publicly readable. To try `ctx.s3` locally without an AWS account, run a throwaway [MinIO](https://min.io/) container (S3-compatible) and seed it with the AWS CLI:

```bash
docker run -d --name sentinel-demo-minio -p 19000:9000 -p 19001:9001 \
  -e MINIO_ROOT_USER=demoaccesskey \
  -e MINIO_ROOT_PASSWORD=demosecretkey123 \
  minio/minio server /data --console-address ":9001"

AWS_ACCESS_KEY_ID=demoaccesskey AWS_SECRET_ACCESS_KEY=demosecretkey123 \
  aws --endpoint-url http://localhost:19000 --region us-east-1 s3 mb s3://sentinel-demo
echo "hello from ctx.s3 in Sentinel" | \
  AWS_ACCESS_KEY_ID=demoaccesskey AWS_SECRET_ACCESS_KEY=demosecretkey123 \
  aws --endpoint-url http://localhost:19000 --region us-east-1 s3 cp - s3://sentinel-demo/hello.txt
```

Then store `demoaccesskey`/`demosecretkey123` as the `S3_ACCESS_KEY`/`S3_SECRET_KEY` secrets and point the examples above at `http://localhost:19000/sentinel-demo/hello.txt` instead of the AWS URL. Tear down with `docker rm -f sentinel-demo-minio` when you're done — nothing here is part of `docker-compose.yml`, it's purely a local scratch fixture for trying the feature out.

### Scheduling & Timeouts

When creating a test, configure:

| Field | Description | Default |
|---|---|---|
| `schedule_ms` | How often the test runs, in milliseconds | 60000 (1 min) |
| `timeout_ms` | Max execution time before the run is marked as `timeout`. No flat cap — but must be at most 80% of `schedule_ms`, so a slow run can never overlap with the next scheduled run of the same test | 5000 (5 s) |
| `retries` | Number of retry attempts on failure before recording a fail | 0 |
| `failure_threshold` | Consecutive failures before a notification is sent | 3 |
| `cooldown_ms` | Minimum time between repeat failure notifications | 300000 (5 min) |

---

## Notification Channels

Sentinel sends alerts on state transitions.

**Supported channel types:** Discord webhook, Slack webhook, generic webhook.

### Setup

1. Go to the **Channels** page in the dashboard.
2. Create a channel with a name and webhook URL.
3. Assign channels to tests (per-test) or to tags (all tests with that tag inherit the channel). Each assignment can be narrowed to a subset of event types (see below), so a single test can route warnings and failures to different channels instead of needing separate tests per event type.

### Alert types

| Event | Trigger | Color |
|---|---|---|
| **Warning** | Test calls `ctx.warn()` — sent on first occurrence, then cooldown-gated | Yellow |
| **Failure** | `consecutive_failures >= failure_threshold` — then cooldown-gated | Red |
| **Recovery** | Test returns to `success` after a warning or failure alert was sent | Green |

Warning and failure alerts have independent cooldown windows — a warning notification does not suppress a subsequent failure alert.

### Per-event-type routing

By default, an assigned channel receives all three alert types. Each assigned channel shows three small toggle pills (F / W / R for failure / warning / recovery) — click a pill to stop that event type from routing to that channel. At least one event type must stay enabled per assignment.

This means a single test can send warnings to a low-priority Slack channel while routing failures to a paging Discord webhook, without splitting the check into two separate tests.

### Alert payloads

- **Warning alert** — includes test name and warning message.
- **Failure alert** — includes test name, failure reason, last response time, and consecutive failure count.
- **Recovery alert** — includes test name, downtime duration since the first alert, and last response time.

Discord alerts use colored embeds (yellow for warning, red for failure, green for recovery). Slack alerts use attachments with the same colors. Generic webhooks receive a JSON payload with an `event` field (`"warning"`, `"fail"`, or `"recovery"`).

---

## Secrets

Store API keys and other credentials outside test code, read them in tests via [`ctx.secrets.NAME`](#ctxsecrets--encrypted-secret-access).

### Setup

1. Go to the **Secrets** page in the dashboard.
2. Create a secret with a name (`UPPER_SNAKE_CASE`, e.g. `API_KEY`) and a value.
3. Reference it in test code as `ctx.secrets.API_KEY`.

### Write-only by design

Once created, a secret's value is **never returned by any API response again** — the dashboard and `GET /secrets` only ever show the name and timestamps. To change a value, use **rotate** (submit a new value); there's no "edit" or "reveal" action. Deleting a secret removes it immediately; any test still referencing it will simply see `undefined`.

### Encryption at rest

If `SECRETS_ENCRYPTION_KEY` is set (see [Environment Variables](#environment-variables)), values are encrypted with AES-256-GCM before being stored. If it's unset, values are stored unencrypted and the Secrets page shows a warning banner — `ctx.secrets` works either way. Secrets created while the key was unset stay unencrypted until individually rotated after the key is configured; there's no bulk re-encryption tool.

### API

| Method | Path | Description |
|---|---|---|
| `GET` | `/secrets` | List secret names and timestamps (never values) |
| `GET` | `/secrets/status` | `{ encryptionEnabled: boolean }` |
| `POST` | `/secrets` | Create a secret: `{ name, value }` |
| `POST` | `/secrets/:id/rotate` | Replace a secret's value: `{ value }` |
| `DELETE` | `/secrets/:id` | Delete a secret |

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

--- 

## License

Sentinel is dual-licensed:

- Open Source: GNU Affero General Public License v3 (AGPL v3)
- Commercial: Proprietary commercial license available

The AGPL license allows free use, modification, and self-hosting, provided AGPL obligations are respected.

Organizations that want to use Sentinel in proprietary, closed-source, or commercial SaaS environments without AGPL obligations must obtain a commercial license.

See:
- `LICENSE`
- `LICENSE-COMMERCIAL.md`

Commercial licensing contact:

victor@territorial.dev