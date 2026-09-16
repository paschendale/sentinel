# RBMC branch — what is different from mainline Sentinel

This branch (`rbmc`) turns Sentinel into a monitor for the real-time stations of
IBGE's **RBMC** (Rede Brasileira de Monitoramento Contínuo dos Sistemas GNSS).
It is a long-lived fork: it is **never merged into** `main`, it has its own CI
and its own Docker image, and it keeps everything mainline Sentinel does
(tests, tags, channels, secrets, MCP) while adding the station layer described
below. Everything not listed here behaves exactly as on `main`.

---

## 1. What is monitored and how

IBGE streams each station over NTRIP from the public **RBMC-IP** caster
(`gps-ntrip.ibge.gov.br:2101`). The caster's *sourcetable* (`GET /`) lists one
`STR` line per live mountpoint. Mountpoints are the station's 4-letter code plus
a suffix: `VICO0` (RTCM 3.2/3.3 MSM) and, for some stations, `VICO1` (legacy
RTCM 3.0).

Each station has **exactly one test**. It passes when at least one `RBMC-IP`
mountpoint whose first four characters equal the station code (`SG_RBMC`) is
listed. Every mountpoint found gets its own passing assertion naming it and its
format/receiver, e.g. `VICO0 is online (RTCM 3.2 GPS+GLO+GAL+BDS+SBAS via
TRIMBLE NETR9)` — this is what the admin and public UIs show per-mountpoint in
a run's assertion list, not just the run log. A final assertion covers the
overall station outcome. Stations absent from the caster fail that assertion
with `No mountpoint starting with CODE in the RBMC-IP sourcetable`.

Test defaults mirror the hand-made tests the instance started with:
15-minute schedule, 10 s timeout, failure threshold 3, 24 h cooldown, tag `rbmc`.
`failure_threshold` is legacy now (kept only for display): a station only
shows "down" on the map, or fires a fail notification, after failing
continuously for over an hour (`PUBLIC_STATUS_WINDOW_MS`); `cooldown_ms` still
gates how often a repeat notification can fire while it stays down. This is a
mainline change (`apps/api/src/db/public-status.ts`, RULES.md #19), not
RBMC-specific — it just matters most here since RBMC stations are most of
what's monitored on this instance.

---



## 2. The shapefile is the source of truth

The station list is IBGE's *RBMC/GNSS Permanente* shapefile,
`RBMCPoint.{shp,shx,dbf,prj,cst}`, shipped at `apps/api/data/rbmc/` and baked
into the image. Only `.shp` (Point geometry) and `.dbf` (attributes, latin-1,
NUL-padded text) are read. The `SG_RBMC` column is the station code and primary
key; `ESTACAO`, `UF`, `GEOCODIGO`, `ALTGEOM` and the point coordinates
(SIRGAS 2000 geographic, EPSG:4674) are stored alongside.

**To change the station list, replace the files.** Nobody edits station rows or
station tests by hand:

- bind-mount a directory with the five files over `/app/apps/api/data/rbmc`
(see the commented `volumes:` block in `docker-compose.yml`), or point
`RBMC_SHAPEFILE_DIR` at one;
- the API polls the files' mtime every `RBMC_SYNC_POLL_MS` (default 60 s) and
re-syncs once the mtime has been stable for two polls (guards against a
half-copied mount);
- to apply immediately, call `POST /rbmc/sync` (JWT) or the MCP tool
`sync_rbmc_stations`.

The reader is hand-written and dependency-free (`apps/api/src/rbmc/shapefile.ts`).
A corrupt or missing file fails the sync and is logged; a bad row (blank or
duplicate code, unusable coordinates, deleted record) is skipped and logged.
The process never crashes because of the shapefile (RULES #16).

---



## 3. The sync (`apps/api/src/rbmc/sync.ts`)

Runs once after the API starts listening (in the background, never awaited),
on every mtime change, and on demand. Per station it:


| Situation                                                                                                                                     | Action                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Station already linked to a test that still exists                                                                                            | Leave it alone; rewrite `name`/`code` only if they drifted from the current template version                                                                                                                   |
| Not linked, but a test named `RBMC - CODE0 - City` / `RBMC - CODE1 - City` / `RBMC - CODE - City` exists (or its JS contains the quoted code) | **Adopt** it: rename to `RBMC - CODE - City`, replace the code, link it. History and incidents are kept. Prefers `0`, then unsuffixed, then `1`; oldest wins. Other matches for the same code are **disabled** |
| Nothing adoptable                                                                                                                             | **Create** a test with the defaults above; the city label comes from the sourcetable identifier when the caster is reachable, otherwise the code                                                               |
| Station disappeared from the shapefile                                                                                                        | Row flagged `in_shapefile = false`, its test **disabled**, it drops off the map                                                                                                                                |
| Station is back in the shapefile                                                                                                              | Its test is **re-enabled**                                                                                                                                                                                     |


Rules the sync never breaks: it never deletes a test, never changes
`schedule_ms`/`timeout_ms`, and never touches `enabled` on a test that is
linked and present (toggling `enabled` is the one manual edit that sticks).
All writes happen in one transaction with multi-row statements; scheduler
events and compiled-code cache invalidation fire only after `COMMIT`, disables
first so leftover timers stop before new ones start. Concurrent sync calls share
one run.

On the existing RBMC instance the first sync adopted 119 tests, created 38 and
disabled 24 `…1` siblings (157 stations total).

---



## 4. New pieces of the API


| Piece                                   | Mainline | RBMC branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table `rbmc_stations` (migration `017`) | —        | `code` PK, `test_id` (unique FK → tests), `station_id`, `uf`, `geocodigo`, `lat`, `lon`, `alt_geom`, `name`, `in_shapefile`, `template_version`, `synced_at`                                                                                                                                                                                                                                                                                                                                                        |
| `ctx.ntrip.sourcetable(url?)`           | —        | Returns the parsed `STR` rows (`mountpoint`, `identifier`, `format`, `formatDetails`, `navSystem`, `network`, `country`, `lat`, `lon`, `generator`). Sends the `Ntrip-Version: Ntrip/2.0` handshake headers itself (without them IBGE's caster answers a non-HTTP status line that undici rejects). One process-wide 60 s cache with in-flight de-duplication, so 157 tests cost one download per minute; failures are never cached. Errors are `NtripRequestError` with `NTRIP_FETCH_ERROR` or `NTRIP_PARSE_ERROR` |
| `GET /rbmc` (JWT)                       | —        | Every station with its test, coordinates, `last_status`, `last_run_at`, `in_shapefile`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /rbmc/sync` (JWT)                 | —        | Re-read the shapefile now; `200` with a summary (`stations`, `created`, `adopted`, `updated`, `disabled`, `reenabled`, `skipped`) or `503` when the file could not be read                                                                                                                                                                                                                                                                                                                                          |
| `GET /status/rbmc/map` (public)         | —        | GeoJSON `FeatureCollection`, one Point per station in the shapefile, built only from `rbmc_stations`, `test_state.public_status` and `uptime_daily` (RULES #10). Properties: `code`, `name`, `uf`, `test_id`, `status` (`up`/`degraded`/`down`/`unknown`; disabled → `unknown`), `enabled`, `uptime_pct_30d`, and `mountpoints` when the sourcetable cache is warm. Optional `?tag=` restricts to stations whose test carries that tag (same `$1 = ANY(tags)` filter as `GET /status/tag/:tag`), for the per-tag map on `/status/[tag]`. `Cache-Control: max-age=60`                                                                                                                     |
| MCP tools                               | 21       | 23: adds `list_rbmc_stations` and `sync_rbmc_stations`; the server `instructions` explain the RBMC purpose and that the sync owns station tests                                                                                                                                                                                                                                                                                                                                                                     |
| Log events                              | —        | `test.ntrip` (per run: rows, cached/fetched, ms), `rbmc.sync.*` (`complete`, `failed`, `row_skipped`, `shapefile_changed`, `shapefile_missing`, `sourcetable_unavailable`)                                                                                                                                                                                                                                                                                                                                          |


Generated test code lives in `apps/api/src/rbmc/template.ts`
(`RBMC_TEMPLATE_VERSION`). Bump the version when the body changes and the next
sync rewrites every station test.

---



## 5. New environment variables (all optional)


| Variable                    | Default                                                               | Purpose                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `RBMC_SHAPEFILE_DIR`        | `apps/api/data/rbmc` (module-relative, works under `tsx` and `dist/`) | Directory holding `RBMCPoint.shp`/`.dbf`                                                                                  |
| `RBMC_NTRIP_URL`            | `http://gps-ntrip.ibge.gov.br:2101/`                                  | Sourcetable URL used by `ctx.ntrip.sourcetable()` when no URL is passed and by the sync to learn city names               |
| `RBMC_SYNC_POLL_MS`         | `60000`                                                               | mtime poll interval (5 s – 1 h)                                                                                           |
| `NEXT_PUBLIC_MAP_STYLE_URL` | An OCI Object Storage-hosted Brazil PMTiles extract, dark flavor      | Overrides the map basemap: a `pmtiles://` source URL or a full MapLibre style JSON URL; **web build-time** (Docker `ARG`) |


---



## 6. Web app changes


| Route           | Mainline           | RBMC branch                                                                                                                                        |
| --------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`             | Test table         | Redirects: anonymous → `/login`, authenticated → `/tests`. No page renders here — auth gating is the only thing left at `/`                          |
| `/tests`        | —                  | The test table that used to be `/`. Every "back"/"after save"/"after delete"/tag link now points here                                              |
| `/status`       | Grid/list of tests | Opens on the **map**; grid and list stay one click away (toggle, `?view=map\|grid\|list`, remembered in `localStorage`). Period pills are hidden in map view |
| `/status/[tag]` | unchanged          | Also gets the map, scoped to that tag via `GET /status/rbmc/map?tag=`; same map/grid/list toggle as `/status`                                        |


The map (`apps/web/app/status/_components/rbmc-map.tsx`, lazy-loaded with
`ssr: false` like Monaco and Recharts) uses **maplibre-gl**, **pmtiles** and
**@protomaps/basemaps**. The basemap is read directly from a single remote
`.pmtiles` file over `pmtiles://` (HTTP range requests, no tile server),
styled with Protomaps' dark flavor. The default file is a small Brazil-only
extract hosted in an OCI Object Storage bucket with CORS enabled — Protomaps'
own public PMTiles buckets (`build.protomaps.com`, `latest.protomaps.com`) have
no CORS headers and can't be range-fetched from a browser, so hotlinking them
directly doesn't work (confirmed against the live endpoints; also documented:
"hotlinking to these downloads are discouraged"). If the style fails to load it
falls back to a plain dark background with the stations still drawn. The map is
constructed with `bounds` set to Brazil (with slack for offshore/Uruguayan
stations) so the initial view fits every station regardless of basemap.
Stations are circles coloured emerald/yellow/red/zinc for
up/degraded/down/unknown, disabled ones dimmed with a grey ring; a legend shows
the counts. Hovering a station opens its info panel; clicking locks the panel
to that station (hovering elsewhere no longer changes it) until it is clicked
again or the map's empty space is clicked. The hovered/locked station is
highlighted by recolouring its dot (MapLibre `feature-state`, keyed by station
code via `promoteId`), not a new visual language. The panel itself is
`TestDetailPopover` (`apps/web/app/status/_components/test-detail-popover.tsx`)
— the exact same component the grid/list test cards use for their hover
popover, looked up by the station's `test_id` in the page's already-fetched
test list and bucket data. A station's live mountpoints are not a separate
panel field; they show up the same way any test's assertions do, in the
panel's histogram "last check" tooltip (see §1 — one assertion per mountpoint).
The map refreshes itself from `GET /status/rbmc/map` every 5 minutes; the page
itself stays ISR.

**Worker URL gotcha:** maplibre-gl v6 locates its tile-processing worker via
`import.meta.url` relative to its own module. That resolves fine when the
library is loaded directly from a real static URL, but once webpack bundles it
(as Next does), `import.meta.url` resolves to a chunk URL, not a servable path
— the worker then gets constructed from an empty string and never processes a
single tile, so *nothing* renders (no basemap, no station dots) with no error
surfaced anywhere. `next.config.ts` copies `maplibre-gl-worker.mjs` and
`maplibre-gl-shared.mjs` into `public/` on every dev/build run, and
`rbmc-map.tsx` calls `maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs')`
before creating the map. `middleware.ts`'s `PUBLIC_PATHS` also had to list
both files explicitly — anything outside `_next/static`/`_next/image`/
`favicon.ico` otherwise goes through the auth redirect, which would serve the
login page in place of the worker script to anonymous `/status` visitors.

Note for local checks: `/status` is prerendered at build time with 5-minute ISR,
so right after a deploy it can show the build-time state (no map, no tests) for
up to five minutes. This is mainline behaviour. In `next dev`, `window.__rbmcMap`
exposes the map instance.

---



## 7. Build, CI and deployment

- `Dockerfile` copies `apps/api/data/` into the image and accepts
`NEXT_PUBLIC_MAP_STYLE_URL` as a build arg; `apps/api/Dockerfile` also copies
the migrations and sets `RBMC_SHAPEFILE_DIR=/app/data/rbmc`.
- `.github/workflows/rbmc.yml` is this branch's CI: on every push to `rbmc`
(or manual dispatch) it typechecks, runs the whole API suite against a
Postgres service (integration tests included — `DATABASE_URL` is exported, and
`apps/api/vitest.config.ts` now lets an external `DATABASE_URL` reach
`*.integration.test.ts`), then builds and pushes
`paschendale/sentinel-rbmc:latest` and `paschendale/sentinel-rbmc:sha-<12>`.
No semantic-release, no `CHANGELOG`, no version bumps on this branch.
- The deployment lives in the paschendale.net repo:
`disbelief/sentinel-rbmc/docker-compose.yml` tracks
`paschendale/sentinel-rbmc:latest` (was `paschendale/sentinel:latest`) and
What's Up Docker rolls new images out. A commented `volumes:` block shows how
to mount a replacement shapefile.

---



## 8. Tests added

- `apps/api/src/rbmc/shapefile.test.ts` — the shipped file (157 stations,
unique codes, sane coordinates) plus synthetic bad files.
- `apps/api/src/rbmc/sync.test.ts` — the pure planner: adoption preferences,
duplicates, drift, removal, return, idempotency; the generated code runs
against a fake `ctx`.
- `apps/api/src/rbmc/sync.integration.test.ts` — the transactional core against
a real database, everything rolled back, pre-existing stations passed through
untouched (safe on a populated database).
- `apps/api/src/executor/ntrip-sourcetable.test.ts`, `ctx.test.ts` — parser,
cache sharing/TTL/failure behaviour, handshake headers.
- `apps/api/src/routes/rbmc.test.ts`, `mcp.test.ts` — routes, auth, GeoJSON
shape, tool list.

---



## 9. Where to read more

- `docs/DOMAINS.md` — `RbmcStation` entity and the `ctx.ntrip` contract
- `docs/ARCHITECTURE.md` — "RBMC Station Sync" section, approved dependency `maplibre-gl`
- `README.md` — "RBMC Station Monitoring" section, env-var table
- `IMPLEMENTATION_LOG.md` — entry "2026-09-15 · RBMC"

