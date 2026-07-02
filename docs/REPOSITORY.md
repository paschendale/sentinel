# Sentinel — Repository Structure

## Overview

Sentinel is organized as a **pnpm monorepo** with two applications and one shared package. All packages live under `apps/` or `packages/`.

## Directory Tree

```
sentinel/
├── apps/
│   ├── api/                    # Backend: Fastify API + scheduler + executor + notifier
│   │   ├── src/
│   │   │   ├── routes/         # Fastify route handlers (tests, runs, metrics, status, secrets)
│   │   │   ├── scheduler/      # Job scheduling engine (interval + jitter logic)
│   │   │   ├── executor/       # Test execution engine (compile, run, timeout, secrets cache)
│   │   │   ├── notifier/       # Notification pipeline (Discord, Slack, webhook)
│   │   │   ├── db/             # Postgres client, connection pool, raw SQL queries
│   │   │   ├── crypto/         # AES-256-GCM secret encryption (apps/api/src/crypto/secret-cipher.ts)
│   │   │   ├── metrics/        # Prometheus metrics registration and endpoint
│   │   │   └── index.ts        # App entry point
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                    # Frontend: Next.js dashboard + public status pages
│       ├── app/                # Next.js App Router
│       │   ├── (dashboard)/    # Authenticated dashboard routes
│       │   │   ├── page.tsx    # Test list
│       │   │   ├── tests/
│       │   │   │   ├── new/    # Create test
│       │   │   │   └── [id]/   # Edit / test detail
│       │   ├── secrets/        # Secret management page (write-only create/rotate/delete)
│       │   └── status/
│       │       └── [slug]/     # Public status page (SSG/ISR)
│       ├── components/         # Shared React components
│       │   ├── editor/         # Monaco Editor wrapper (lazy-loaded)
│       │   ├── status/         # Status badge, uptime bar components
│       │   └── ui/             # Generic UI primitives
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   └── shared/                 # Shared TypeScript types + Zod schemas
│       ├── src/
│       │   ├── types.ts        # TypeScript interfaces for all domain entities
│       │   └── schemas.ts      # Zod schemas for API validation
│       ├── package.json
│       └── tsconfig.json
│
├── docs/
│   ├── PRODUCT.md              # What Sentinel is, who it's for
│   ├── ARCHITECTURE.md         # System design, constraints, approved deps
│   ├── DOMAINS.md              # Data model, entities, relationships
│   └── REPOSITORY.md          # This file
├── PROJECT.md                  # Feature backlog with detail — user picks Current Focus
│
├── RULES.md                    # Hard rules for AI agents and contributors
├── .metaprompt                 # Lean AI context file
├── pnpm-workspace.yaml         # pnpm workspace configuration
├── package.json                # Workspace root (no runtime deps)
└── README.md                   # Project intro + quick links
```

## Package Responsibilities

### `apps/api`

The backend is a single long-running Node.js process. It owns:

- **Fastify server** — REST API for test CRUD, run history, metrics
- **Scheduler** — registers a `setInterval` per test, fires execution with jitter
- **Executor** — compiles user JS code, runs it with a `ctx` object, enforces timeout
- **DB writer** — buffers results in memory, flushes in batches every 1–2 seconds
- **Notifier** — listens for state-change events, dispatches webhooks fire-and-forget
- **Secrets** — encrypted (AES-256-GCM, optional key) key-value store exposed to tests as `ctx.secrets.NAME`, backed by an in-memory cache so lookups never hit the DB during a test run
- **Metrics** — registers prom-client counters/histograms, serves `/metrics`

### `apps/web`

A Next.js application serving two distinct surfaces:

- **Dashboard** (server components + Monaco client): authenticated CRUD interface for managing tests, viewing run history
- **Public status pages** (`/status/[slug]`): SSG/ISR pages built from `UptimeDaily` aggregated data — no auth required, fast by design

### `packages/shared`

A zero-dependency internal package (except `zod`) that:

- Defines all TypeScript interfaces matching the domain model
- Exports Zod schemas used for input validation in both the API and web frontend

## Workspace Configuration

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

Cross-package imports use workspace protocol:
```json
"@sentinel/shared": "workspace:*"
```

## Conventions

- All packages use TypeScript strict mode
- No `any` types — use `unknown` and narrow explicitly
- File names: `kebab-case.ts`
- No barrel `index.ts` re-exports unless the package is a public API boundary
- Environment variables: loaded in `apps/api/src/index.ts` only, typed via a `config.ts` module
- All SQL is in `apps/api/src/db/queries/` — one file per domain entity
