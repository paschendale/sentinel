# Deployment

Sentinel is one API process (Fastify, scheduler, executor, notifier), one Next.js web app and PostgreSQL 16. It is built for a small VM: 1 GB RAM and 0.5 vCPU run about 500 tests a minute.

## Images

Two images are published on Docker Hub for every release, both `linux/amd64`:

| Image | Contents | Port |
| --- | --- | --- |
| `paschendale/sentinel` | API, web app and Caddy in one container. Caddy sends `/api/*` to the API and everything else to the web app. | 80 |
| `paschendale/sentinel-api` | The API alone, for when the web app is hosted elsewhere. | 3001 |

Both are tagged `latest` and with the release version (`v1.30.0`). PostgreSQL is not included.

The API applies pending migrations when it starts, then starts the scheduler. It retries the first database connection with backoff, so starting it before the database is ready is fine.

## Docker Compose

The full image with a database:

```bash
curl -O https://raw.githubusercontent.com/territorial-dev/sentinel/main/docker-compose.yml
docker compose up -d
```

Change `ADMIN_PASSWORD`, `JWT_SECRET` and the database password before the first start. The status page is at `http://<host>/`, sign-in at `http://<host>/admin`, and the API at `http://<host>/api`.

### API only

`docker-compose.cloudflare.yml` runs PostgreSQL and `paschendale/sentinel-api` on port 3001. Deploy `apps/web` separately (for example to Cloudflare or Vercel) with `API_URL` and `NEXT_PUBLIC_API_URL` set to the API's public URL.

```bash
curl -O https://raw.githubusercontent.com/territorial-dev/sentinel/main/docker-compose.cloudflare.yml
docker compose -f docker-compose.cloudflare.yml up -d
```

### Single container

```bash
docker run -d \
  -e DATABASE_URL=postgres://user:pass@db-host:5432/sentinel \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=change-me \
  -e JWT_SECRET=a-long-random-string \
  -p 80:80 \
  paschendale/sentinel:latest
```

## Environment variables

Only the four in the first table are required. Everything else is optional and has a safe default. A value that is set but malformed (not a number, out of range, a key of the wrong length) stops the API at startup with a message naming the variable.

### Required (API)

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/sentinel`. The pool uses at most 5 connections. |
| `ADMIN_USERNAME` | The single admin account. |
| `ADMIN_PASSWORD` | Its password. |
| `JWT_SECRET` | Signs sign-in sessions and API tokens. Use a long random string. Changing it signs everyone out and invalidates every API token. |

### API, optional

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | API port. The full image fixes it at 3001 behind Caddy on 80. |
| `NODE_ENV` | `development` | Set `production` for JSON logs. |
| `LOG_LEVEL` | `info` | Pino level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. |
| `LOG_PRETTY` | on unless production | `true` prints one readable line per event instead of JSON. |
| `SECRETS_ENCRYPTION_KEY` | unset | Base64 of 32 bytes (`openssl rand -base64 32`). Encrypts secrets and bot tokens at rest with AES-256-GCM. Unset: values are stored unencrypted, `ctx.secrets` still works, and the Secrets page shows a warning. Values written before the key was set stay unencrypted until rotated. |
| `RESEND_API_KEY` | unset | Resend API key. Email channels need it. |
| `RESEND_FROM` | unset | Sender address for email channels, e.g. `Sentinel <alerts@example.com>`. |
| `SENTINEL_INSTANCE` | unset | A name for this deployment (letters, digits, `.`, `_`, `-`; up to 64), e.g. `eu-west-1`. Added to the User-Agent of every outbound request and sent as `X-Sentinel-Instance`. |
| `INCIDENT_THREAD_HEARTBEAT_MS` | `3600000` (1 h) | How often an open bot-channel thread gets a "Still in outage" reply while nothing changes. 1 min to 7 d. |
| `RAW_RETENTION_DAYS` | `7` | Days of raw runs and assertions to keep. 1 to 365. |
| `AGG_RETENTION_DAYS` | `90` | Days of daily uptime aggregates to keep. 30 to 180. The status page's 30-day view reads these. |
| `NOTIFICATION_RETENTION_DAYS` | `90` | Days of the notification log and closed bot threads to keep. 7 to 365. |
| `PRUNE_BATCH_SIZE` | `5000` | Rows deleted per batch when pruning. 100 to 50 000. |
| `FTP_TEMP_DIR` | OS temp dir + `sentinel-ftp` | Where `ctx.ftp.get` and `ctx.s3.get` stream downloads. Each file is deleted before the call returns. |
| `FTP_MAX_DOWNLOAD_BYTES` | `5242880` (5 MB) | Largest body any `ctx` call reads (FTP and S3 downloads, `ctx.http`, `ctx.k8s`, `ctx.s3.list`). 1 KB to 50 MB. |
| `FTP_TEMP_MAX_AGE_MS` | `900000` (15 min) | The sweep deletes temp files older than this, left behind by a crash. 1 min to 24 h. |
| `FTP_TEMP_SWEEP_INTERVAL_MS` | `600000` (10 min) | How often the sweep runs. 1 min to 24 h. |
| `SLACK_API_URL` | `https://slack.com/api` | Slack Web API base for `slack_bot` channels. Override only for tests or a proxy. |
| `DISCORD_API_URL` | `https://discord.com/api/v10` | Discord REST base for `discord_bot` channels. Same. |

### Web app, optional

| Variable | Default | Description |
| --- | --- | --- |
| `API_URL` | `http://localhost:3001` | Where server-rendered pages reach the API. The full image sets it. |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Where the browser reaches the API. Baked in at build time; the full image uses `/api`. |
| `STATUS_PAGE_TITLE` | `Service status` | Title of the public status page. Read at request time. |

## Retention and background jobs

- **Daily at 00:00 UTC** the aggregator writes `uptime_daily` for the previous day, then prunes raw runs older than `RAW_RETENTION_DAYS`, aggregates older than `AGG_RETENTION_DAYS`, and notification log rows and closed bot threads older than `NOTIFICATION_RETENTION_DAYS`, in batches of `PRUNE_BATCH_SIZE`. It also makes sure the monthly `test_runs` partitions exist.
- **Stored incidents are never pruned.** Their duration and failed-run count are kept on the incident when it resolves, so they outlive the raw runs.
- **Temp file sweep** every `FTP_TEMP_SWEEP_INTERVAL_MS`.
- **Reconciler** every 5 min resolves incidents whose tests are all Operational, Paused or deleted, and retries closing bot threads whose test has been Operational for 2 min, in case a close failed or the process stopped mid-way.

## Health and metrics

`GET /health` (no auth) runs `SELECT 1` and returns `{ "status": "ok" }`, or `503` with `{ "status": "error", "error": "…" }` when the database is unreachable. Both images use it as their Docker health check.

`GET /metrics` (no auth) serves Prometheus text:

| Metric | Type | Counts |
| --- | --- | --- |
| `sentinel_check_duration_ms` | histogram | Run duration (buckets 50 ms to 10 s) |
| `sentinel_check_success_total` | counter | Passed runs |
| `sentinel_check_warnings_total` | counter | Warned runs |
| `sentinel_check_failures_total` | counter | Failed and timed-out runs |

Logs are structured JSON (pino) in production; they are the main operational output. Each run, notification and job logs an `event` field you can filter on.

## Reverse proxy and URLs

In the full image the API is under `/api`, so the MCP endpoint is `https://<host>/api/mcp`. With the API-only image it is `https://<api-host>/mcp`. Public pages and `/admin` are served by the web app; only `/admin/*` requires the session cookie.

## Upgrading

Pull the new image and restart. Migrations run on start and are additive. Read the release notes first: they call out behaviour changes, such as a test that returns `false` now failing (see [Writing tests](writing-tests.md)).
