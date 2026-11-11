# Contributing

Sentinel is developed mostly by coding agents working from a written brief, with a person deciding what to build and reviewing the result. This file is written for those agents first and for people second. It replaces the old `RULES.md` and `.metaprompt`, which now point here.

If you are an agent: read this file, then the documents listed under "Before you change code", then do the work. The rules below are binding. When one stops you, say so in your report instead of working around it.

## Briefing an agent

A good brief for a Sentinel change has:

1. **The outcome**, in the user's words: what someone can do afterwards that they cannot do now.
2. **The decisions already made**, so the agent does not reopen them (for example "the webhook payload must not change", "no new env var may be required").
3. **The scope**: which apps and packages, and what is explicitly out.
4. **Where to look**: files, routes, migrations, or a prior entry in the [implementation log](docs/dev/IMPLEMENTATION_LOG.md).
5. **How it will be checked**: the commands below, plus anything specific (a screenshot of a page, a curl against a route, an MCP call).

For work spread over several sessions, put the brief and a progress list in a temporary file in the branch, have each session read it first and leave notes for the next, and delete the file in the last commit of the PR.

## Before you change code

- [Architecture](docs/dev/ARCHITECTURE.md) before touching `apps/api/src/executor/`, `scheduler/` or `db/`.
- [Domain model](docs/dev/DOMAINS.md) before any schema or entity change.
- [Design system](docs/dev/DESIGN.md) before any page or component.
- [Writing tests](docs/guide/writing-tests.md) before changing `ctx`.
- [Roadmap](ROADMAP.md) for what is planned and what is out of scope.

## Rules

They exist because of hard limits (1 GB RAM, 0.5 vCPU) and deliberate design decisions.

### Dependencies

1. No new dependency without a reason a few lines of code cannot meet. Check the approved list in [ARCHITECTURE.md](docs/dev/ARCHITECTURE.md#dependencies) and add to it in the same change.
2. Banned: `axios`, `express`, `redis`, `bullmq`, `prisma`, `typeorm`, `sequelize`, `knex`, `drizzle`, `lodash`, `moment`, any UI kit (MUI, Chakra, Mantine, Ant Design), `styled-components`.
3. No packages with native bindings (`.node` files) without the owner's approval.

### Database

4. Raw SQL only, through `pg`. SQL lives in `apps/api/src/db/queries/` (move route SQL there when you touch a route).
5. Batch writes. Never `INSERT` rows one by one in a loop; buffer and flush in batches of 50 to 100.
6. The pool has at most 5 connections. Do not raise it.
7. Public routes (`GET /status*`) go through the in-process cache in `routes/public-cache.ts`, validate and bound their parameters, and return 400 on bad input. The 30-day view reads `uptime_daily`; shorter periods may read `test_runs` through the indexed `started_at`, never uncached.
8. Migrations are plain numbered SQL files, additive only: add columns and tables, never drop or rename what a released version reads. Upstream numbers `001` to `899`; `900` to `999` belong to forks.

### Execution

9. Never block the event loop: no sync I/O or heavy CPU in hot paths. Sync reads at startup are fine.
10. User code always runs under a timeout (`Promise.race`), and its pending I/O is aborted when the timeout fires.
11. User code gets only `ctx`: no `require`, `import`, `process` or filesystem.
12. Compile user code once on save and cache it. Reject code that does not compile with 400.
13. Startup and cache-warming code catches failures per row, logs them and skips the row. One bad row never stops the process. Verify by restarting with a broken row, not only with a unit test.

### Notifications

14. Notifications are fire-and-forget: never awaited on the test path, every delivery wrapped so it logs instead of throwing, every request with a timeout.
15. Alert on state changes only, after the failure threshold and outside the cooldown.

### API compatibility

16. Change what people read, not what programs read. Stored values, JSON field names and values, API route paths, MCP tool names and webhook payload fields keep working. Map wire values to words in one place (`packages/shared/src/state.ts`).
17. Errors are `{ error: string, details?: … }`. Keep existing success shapes.

### Configuration

18. Environment variables are read once, in `apps/api/src/config.ts`; the web app reads its few in `apps/web/lib/` only.
19. New environment variables are optional with a safe default. Degrade gracefully and warn in the logs or the UI when one is unset. Fail at startup only when a value is present but malformed.

### Frontend

20. Server Components by default; Client Components only for interaction.
21. Monaco and Recharts are dynamically imported with `ssr: false`.
22. Colours, type and spacing come from the tokens. No raw palette classes or hex values in components.
23. Public pages render per request from the cached public API and refresh every 60 s; they never call signed-in routes and never link to `/admin`.
24. Follow [DESIGN.md](docs/dev/DESIGN.md): its vocabulary, writing rules and components. Add a missing component there first, then use it.

### Code style

25. TypeScript strict, no `any`: use `unknown` and narrow.
26. File names in `kebab-case`. No barrel `index.ts` inside `apps/api/src/`.
27. Generic code and docs only. Sentinel serves several clients; no client names, hosts or data in code, docs, tests or examples. Use `example.com`.

### The MCP text rule

28. Agents operate Sentinel through MCP and never read `docs/`. Their only view of what Sentinel can do is the `instructions` string in `apps/api/src/routes/mcp.ts` and the tool descriptions in `apps/api/src/mcp/tools.ts`. Any change that adds, removes or changes a capability updates them in the same change. The instructions are a condensed copy of the guides; when you edit one, edit the other.
29. An agent-operable REST route gets an MCP tool, not just the route. Actions reserved for a person (publishing) get no tool and return 403 to API tokens.

### Forks

30. The fork slots (`apps/api/src/fork/extension.ts`, `apps/web/fork/status-lead.tsx`) stay empty upstream and are never edited, so forks that replace them pull without conflicts. When a fork needs a new hook, add a new slot and document it in [FORKING.md](docs/FORKING.md); keep `ForkExtension` backward compatible (new members optional).

Ask yourself before finishing: would an agent that sees only the tool descriptions and the server instructions know this exists and how to use it?

## Checks

Run these before you report a change as done, and say which you ran.

```bash
pnpm -r typecheck                       # all packages
pnpm --filter @sentinel/shared build    # the API tests import the built package
pnpm --filter @sentinel/api test        # unit + integration tests
pnpm --filter @sentinel/web build       # catches server/client boundary errors
```

- **The API tests need a throwaway PostgreSQL.** `vitest.config.ts` expects `postgresql://sentinel:sentinel@localhost:5432/sentinel_test`; start one in Docker (`docker run --rm -d --name sentinel-test-pg -e POSTGRES_USER=sentinel -e POSTGRES_PASSWORD=sentinel -e POSTGRES_DB=sentinel_test -p 5432:5432 postgres:16`) and run `pnpm --filter @sentinel/api migrate:ci` against it. The test setup loads `apps/api/.env` if it exists, so never run the tests on a machine whose `.env` points at a real database. Integration tests skip when no database is reachable; say so if they skipped.
- **UI changes:** look at every page you changed in dark and light, at 1280 and 400 px wide (headless Chrome works: `--headless=new --screenshot=out.png --window-size=1280,1500 <url>`). No horizontal page scroll at 400 px.
- **Before committing:** `git grep` for words the [vocabulary](docs/dev/DESIGN.md#vocabulary) retired if you touched UI, notification or MCP text.

CI runs the API tests with coverage on every pull request to `main`.

## Commits and pull requests

- Conventional commits: `<type>(<scope>): <description>`. Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`. Scopes: `api`, `web`, `shared`, `db`, `scheduler`, `executor`, `notifier`.
- One logical change per commit.
- No AI attribution or `Co-Authored-By` lines.
- semantic-release cuts versions from `main`: `feat` is a minor, `fix` a patch, and a `BREAKING CHANGE` footer a major. Put upgrade notes for behaviour changes in the PR description rather than a footer unless a major is intended.
- The PR description says what changed by area, what stays compatible, which migrations it adds, and what an operator must do on upgrade.

## Implementation log

When the work is done, append an entry to [docs/dev/IMPLEMENTATION_LOG.md](docs/dev/IMPLEMENTATION_LOG.md). Future sessions read it to avoid re-deriving context. Keep it factual and short:

```
## YYYY-MM-DD · <area or feature ID> · <name>

**What was built:** 1–3 sentences.
**Files changed:** key files created or modified.
**Decisions:** non-obvious choices and why.
**Deferred:** what was left out or noted for later.
```

## Checklist

- [ ] New dependency? Is it justified and on the approved list?
- [ ] Writes to the database? Batched?
- [ ] Runs user code? Under a timeout, with I/O aborted on timeout?
- [ ] New client-side import in Next.js? Dynamically imported if heavy?
- [ ] Public route? Cached, validated, bounded, no internal text?
- [ ] New environment variable? Optional, documented in [deployment](docs/guide/deployment.md)?
- [ ] Loads rows into a cache at startup? One bad row degrades gracefully?
- [ ] Capability change? MCP instructions and tool descriptions updated, guides updated?
- [ ] Words people read follow the vocabulary?
- [ ] Implementation log entry added?
