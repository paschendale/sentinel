# Forking Sentinel

Fork Sentinel when you need something upstream will not carry: your own look, a protocol only your services speak, a page for your domain. Sentinel has no theming or plugin settings on purpose. A fork changes token values and adds files, and keeps pulling from upstream.

The rule that makes this work: **add files, change values, and edit shared files as little as possible.** Every line you change in an upstream file is a line that can conflict on the next pull.

## What a fork looks like

The station monitor fork (the RBMC branch, moving to its own repository) is the reference example. On top of upstream it adds:

- a `ctx` protocol (`ctx.ntrip.sourcetable()`) that reads a caster's station table through a shared 60 s cache;
- a migration and a sync job that read a station list from a data file, create one test per station, adopt tests made by hand and pause tests of removed stations;
- two MCP tools to list stations and run the sync, and a paragraph in the MCP instructions saying which tests the sync owns;
- a public page with the stations on a map, built from the shared components;
- token values for its own look.

Everything else (scheduling, notifications, incidents, the status page) is upstream code, untouched.

## Set up

```bash
git clone https://github.com/<you>/sentinel.git
cd sentinel
git remote add upstream https://github.com/territorial-dev/sentinel.git
```

Work on your own long-lived branch or on your fork's `main`. Keep upstream's `main` as it is, so a pull is a plain merge.

## Pull from upstream

```bash
git fetch upstream
git merge upstream/main          # or rebase your branch on it
pnpm install && pnpm -r typecheck && pnpm --filter @sentinel/api test
```

Read upstream's release notes and the [implementation log](dev/IMPLEMENTATION_LOG.md) for anything that changes behaviour. Upstream keeps the API backward compatible: route paths, JSON fields, MCP tool names and stored values do not change, and migrations are additive.

## Restyle

Edit the values in `apps/web/app/styles/tokens.css`: colours for dark and light, fonts, spacing, radii. Components only read the variables, so this is the whole restyle. Replace the logo files in `apps/web/assets/Logos/` and `apps/web/app/icon.svg` if you have your own mark.

Keep the meaning of the state colours (Operational, Degraded, Outage) and the shapes; change their shades if you need to. The rules are in [DESIGN.md](dev/DESIGN.md).

Set `STATUS_PAGE_TITLE` for the status page title; it needs no code.

## The fork slots

Two files exist upstream only for forks to replace. Upstream ships them empty and never edits them, so a fork that replaces them never conflicts there:

| File | What it holds |
| --- | --- |
| `apps/api/src/fork/extension.ts` | The fork's API additions: routes, `ctx` members, MCP tools and instructions, background jobs. The shape is `ForkExtension` in `apps/api/src/extensions.ts`. |
| `apps/web/fork/status-lead.tsx` | `StatusLead`, shown on the public status page between the header and the list of checks, on `/` and on every `/status/[tag]` page. |

Two folders are there for the same reason: `apps/api/data/` for data files the fork ships with its image (both images copy it next to the compiled API, at `../data` from `dist/`), and `.github/workflows/` takes the fork's own workflows as new files. Upstream's release workflow only releases from `territorial-dev/sentinel`, so in a fork it runs the tests and stops.

Everything else a fork adds goes in new files next to them. If you need a hook upstream does not have, add it upstream as a slot (a pull request against `territorial-dev/sentinel`) rather than editing a shared file in your fork.

```ts
// apps/api/src/fork/extension.ts in a fork
import type { ForkExtension } from '../extensions.js'
import { stationRoutes } from './routes.js'
import { stationTools } from './mcp-tools.js'
import { startStationSync, stopStationSync } from './sync.js'

export const fork: ForkExtension = {
  routes: stationRoutes,
  ctx: (run) => ({ ntrip: ntripFor(run) }),
  mcpTools: stationTools,
  mcpInstructions: ['This instance monitors … Use list_stations to …'],
  start: startStationSync,
  stop: stopStationSync,
}
```

## Add a `ctx` protocol

1. Put the implementation in your fork's folder, for example `apps/api/src/fork/ctx-<name>.ts`: request building, parsing, an error class with `code` values (`<NAME>_FETCH_ERROR`, `<NAME>_TIMEOUT_ERROR`, …).
2. Return it from `ctx` in the extension. The factory runs once per test run and gets the run's abort `signal` (pass it to every request so it stops when the run times out) and its logger. Upstream members (`http`, `s3`, …) cannot be replaced.
3. Follow the executor rules: a per-request `timeout`, the body size cap, `withSentinelHeaders()` on outbound requests, a clear error on failure. Use `undici`, not a new client library.
4. Add tests next to the file.
5. Tell agents: add a paragraph to `mcpInstructions` naming the method and what it returns.
6. Document it in your fork's own docs, for example `docs/fork/`.

## Add a page

- **On the status page:** replace `StatusLead` in `apps/web/fork/status-lead.tsx`. It is a Server Component; read only from the public API (`/status*`), including public routes your fork adds.
- **A new public page:** a new route under `apps/web/app/(public)/`, for example `(public)/map/page.tsx`. It gets the public footer from the group layout. Read only from the public API and link no `/admin` page.
- **Signed in:** a new route under `apps/web/app/admin/(app)/`. It gets the app header and the session gate.
- Build pages from the components in `apps/web/app/_components/ui/`. Put components upstream does not have in your fork's folder, `apps/web/fork/`, rather than editing a shared one.

## Add API routes and tools

Register them from the extension: `routes` is a Fastify plugin registered after upstream's routes, and `mcpTools` runs after upstream's tools on every MCP request. Routes under `/status/` are public (no token): cache them like `routes/public-cache.ts` does, and validate and bound their parameters. Put the SQL in your fork's folder too. Follow the rules in [CONTRIBUTING.md](../CONTRIBUTING.md): batched writes, optional env vars (read them in a config file in your fork's folder), the error shape.

Background jobs (a sync, an import) start from `start` and stop in `stop`. `start` must never throw, and one bad row must never stop the process.

## Add a migration

Migrations are applied by file name and recorded in `schema_migrations`, so a fork's and upstream's migrations coexist as long as the names differ. **Upstream numbers `001` to `899`. Use `900` to `999` in a fork**: `900_stations.sql`, `901_station_coords.sql`. Upstream's new migrations then sort before yours and still run on your databases, because each file is applied once by name, whatever the order it arrives in.

Keep fork migrations additive: your own tables, or new nullable columns on upstream tables. Do not alter or drop upstream columns; a later upstream migration may depend on them.

## Contributing back

A protocol, component or fix that others could use belongs upstream. Open a pull request against `territorial-dev/sentinel` following [CONTRIBUTING.md](../CONTRIBUTING.md); once it lands you can drop your fork's copy at the next pull. What goes upstream must be generic: no client names, hosts or data in code, docs or examples. Your fork can carry its own.
