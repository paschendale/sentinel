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

## Add a `ctx` protocol

1. Put the implementation in a new file, `apps/api/src/executor/ctx-<name>.ts`: request building, parsing, an error class with `code` values (`<NAME>_FETCH_ERROR`, `<NAME>_TIMEOUT_ERROR`, …).
2. In `apps/api/src/executor/ctx.ts`, add the method signatures to `TestContext` and one line in the `ctx` object that calls your file. This is the only shared file you edit.
3. Follow the executor rules: the run's abort signal and per-request `timeout`, the body size cap, `withSentinelHeaders()` on outbound requests, an `io_error` with your protocol name on failure. Use `undici`, not a new client library.
4. Add tests next to the file.
5. Tell agents. `MCP_INSTRUCTIONS` in `apps/api/src/routes/mcp.ts` is an array of paragraphs: add one for your protocol. Add the method to the `create_test` description in `apps/api/src/mcp/tools.ts` if test authors need it there.
6. Document it in your fork's copy of [writing tests](guide/writing-tests.md), in a section of its own.

## Add a page

- **Public:** a new route under `apps/web/app/(public)/`, for example `(public)/map/page.tsx`. It gets the public header and footer from the group layout. Read only from the public API (`/status*`) or from a public route you add, cache it like `routes/public-cache.ts` does, and link no `/admin` page.
- **Signed in:** a new route under `apps/web/app/admin/(app)/`. It gets the AppHeader and the session gate. To show it in the nav, add one entry to the `NAV` list at the top of `apps/web/app/_components/ui/app-header.tsx`.
- Build it from the components in `apps/web/app/_components/ui/`. If you need a component upstream does not have, add it in a new file in your fork instead of editing a shared one.

## Add API routes and tools

Add a route file in `apps/api/src/routes/` and register it in `server.ts` (one line). Put its SQL in a new file in `apps/api/src/db/queries/`. If agents should use it, add an MCP tool in a new function and call it from `registerMcpTools`, or append to `tools.ts`. Follow the rules in [CONTRIBUTING.md](../CONTRIBUTING.md): batched writes, optional env vars, the error shape.

Background jobs (a sync, an import) start from `apps/api/src/index.ts` next to the others and must never let one bad row stop the process.

## Add a migration

Migrations are applied by file name and recorded in `schema_migrations`, so a fork's and upstream's migrations coexist as long as the names differ. **Upstream numbers `001` to `899`. Use `900` to `999` in a fork**: `900_stations.sql`, `901_station_coords.sql`. Upstream's new migrations then sort before yours and still run on your databases, because each file is applied once by name, whatever the order it arrives in.

Keep fork migrations additive: your own tables, or new nullable columns on upstream tables. Do not alter or drop upstream columns; a later upstream migration may depend on them.

## Contributing back

A protocol, component or fix that others could use belongs upstream. Open a pull request against `territorial-dev/sentinel` following [CONTRIBUTING.md](../CONTRIBUTING.md); once it lands you can drop your fork's copy at the next pull. What goes upstream must be generic: no client names, hosts or data in code, docs or examples. Your fork can carry its own.
