# Sentinel

Synthetic testing and uptime monitoring for developers. Write tests as JavaScript, run them on a schedule, get alerted when something changes, and publish a status page.

[![Test](https://github.com/territorial-dev/sentinel/actions/workflows/test.yml/badge.svg)](https://github.com/territorial-dev/sentinel/actions/workflows/test.yml)
![Coverage](.badges/coverage.svg)
[![Docker](https://img.shields.io/docker/v/paschendale/sentinel?label=docker)](https://hub.docker.com/r/paschendale/sentinel)

Sentinel is open source from [territorial.dev](https://territorial.dev). It runs on a small VPS (1 GB RAM, 0.5 vCPU) with one Node.js process and PostgreSQL.

## What it does

A test is a JavaScript function body. It gets a `ctx` object and fails when it throws, fails a `ctx.assert`, or returns exactly `false`:

```js
const res = await ctx.http.get('https://api.example.com/health', {
  headers: { Authorization: `Bearer ${ctx.secrets.API_KEY}` },
  timeout: 4000,
})
ctx.assert('status is 200', res.status === 200)
const body = res.json()
if (body.queueDepth > 1000) ctx.warn(`queue depth ${body.queueDepth}`)
```

Sentinel runs it every interval and turns the results into a state people read: **Operational**, **Degraded** or **Outage** (plus Recovered, No data and Paused).

## Features

- **Tests as code** with `ctx.http`, `ctx.ftp`, `ctx.s3` (get, head, list; SigV4, any S3-compatible service), `ctx.k8s` (read-only Kubernetes API checks), named assertions, warnings and encrypted secrets.
- **Scheduling** with per-test interval, timeout, retries, failure threshold and cooldown. Code is compiled when you save it, so a syntax error is rejected before it runs.
- **Public status page** at `/`, per tag at `/status/<tag>`, with history over 1 h, 24 h, 7 d or 30 d, published incidents, and light and dark themes.
- **Incidents** opened and resolved automatically, with a timeline, internal notes and a report in internal and public versions. A person publishes; agents can draft.
- **Notifications** to Discord, Slack, generic webhooks, email (Resend), and Discord or Slack bots that keep one thread per incident. Route by test or by tag, per event type.
- **Admin** under `/admin`: search, tag filters, bulk actions, a Monaco editor, run now with live logs, secrets and API tokens.
- **MCP server** at `/mcp` so agents such as Claude Code can manage tests, channels, secrets and incidents.
- **Operations:** Prometheus metrics at `/metrics`, `/health`, JSON export and import of tests.

## Quickstart

```bash
curl -O https://raw.githubusercontent.com/territorial-dev/sentinel/main/docker-compose.yml
# edit ADMIN_PASSWORD, JWT_SECRET and the database password
docker compose up -d
```

Open `http://localhost` for the status page and `http://localhost/admin` to sign in. Create a test:

```js
const res = await ctx.http.get('https://example.com')
return res.status === 200
```

The [deployment guide](docs/guide/deployment.md) covers every environment variable, the API-only image for split hosting, retention, and upgrades.

### Local development

Requirements: Node.js 20+, pnpm 9+, PostgreSQL 16+.

```bash
pnpm install
cat > apps/api/.env <<'EOF'
DATABASE_URL=postgres://postgres:postgres@localhost:5432/sentinel
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
JWT_SECRET=dev-secret
EOF
printf 'API_URL=http://localhost:3001\nNEXT_PUBLIC_API_URL=http://localhost:3001\n' > apps/web/.env.local
pnpm migrate
pnpm dev
```

The API listens on 3001 and the web app on 3000. The API also applies pending migrations when it starts.

## Connect an agent

Sign in, open **API tokens** (`/admin/tokens`), generate a token and run the command it shows:

```bash
claude mcp add sentinel --transport http https://sentinel.example.com/api/mcp \
  --header "Authorization: Bearer <token>"
```

Agents see the same capabilities as the REST API. Publishing an incident or a report stays with a signed-in person.

## Documentation

Using Sentinel:

- [Writing tests](docs/guide/writing-tests.md): the `ctx` reference, limits, examples
- [Notifications](docs/guide/notifications.md): channels, routing, bot threads, payloads
- [Status and incidents](docs/guide/status-and-incidents.md): states, sections, the status page, incidents and reports
- [Deployment](docs/guide/deployment.md): images, environment variables, retention, health and metrics
- [API reference](docs/reference/api.md): every REST route, authentication, MCP setup and tools

Building on Sentinel:

- [Contributing](CONTRIBUTING.md): how Sentinel is developed (mostly by agents), the rules and the checks
- [Forking](docs/FORKING.md): restyle with tokens, add a `ctx` protocol, a page or a migration, keep pulling upstream
- [Architecture](docs/dev/ARCHITECTURE.md), [domain model](docs/dev/DOMAINS.md), [design system](docs/dev/DESIGN.md)
- [Roadmap](ROADMAP.md) and the [implementation log](docs/dev/IMPLEMENTATION_LOG.md)

## License

Sentinel is dual-licensed:

- Open source: GNU Affero General Public License v3 ([`LICENSE`](LICENSE)). Free to use, modify and self-host under the AGPL's terms.
- Commercial: for proprietary, closed-source or SaaS use without AGPL obligations ([`LICENSE-COMMERCIAL.md`](LICENSE-COMMERCIAL.md)).

Commercial licensing: victor@territorial.dev
