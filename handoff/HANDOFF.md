# Sentinel revamp — handoff

Temporary. This folder (`handoff/`) is deleted in the last commit of the PR. Do not link to it from any permanent doc.

One PR, branch `feat/revamp` from `main`, implemented over three sessions (A backend, B web, C docs and wrap-up). Each session reads this file first, does its part, ticks the progress list at the bottom and adds notes for the next one.

## What this is

Sentinel grew feature by feature for six months and lost cohesion. This PR:

1. applies a design system to the whole web app and reworks the admin UI;
2. makes the public status page the landing page and moves everything signed-in under `/admin`;
3. fixes the reliability defects an audit found;
4. adds stored incidents with outage reports, and search plus bulk actions;
5. unifies the vocabulary people read;
6. restructures the docs and makes the repo fork-friendly.

## Decisions already made by the owner (do not reopen)

- **Public status page comes first.** The admin side serves one operator and their agents.
- **Customization comes from forks, never from UI settings.** No theming or branding options. A fork changes token values and adds pages.
- **API stays backward compatible.** Change only what people see. Stored values, JSON field values, route paths under the API, MCP tool names and webhook payload fields keep working. Migrations are additive. New env vars are optional.
- **Words people read:** Operational / Degraded / Outage, plus Recovered, No data, Paused. Runs: Passed / Warned / Failed / Timed out. Full table in `design/brand-book.md`. Wire values (`up/degraded/down`, `success/warn/fail/timeout`, `fail/warning/recovery`, section keys `critical/warning/recovered/clean/disabled`) do not change; map them to labels in one shared place.
- **Themes:** dark and light. Dark is default signed in; public pages follow the OS with a Light / Dark / System switch.
- **Type:** Inconsolata for interface, Inter for prose.
- **Logo:** the Beacon (`design/logo/`). It replaces `sentinel-logo.tsx`, `app/icon.svg` and `assets/sentinel.svg`.
- **Routes:** `/` is the public status page. Sign-in is at `/admin`. See "Routes" below.
- **Incidents are internal until a signed-in person publishes.** Agents can add notes and draft reports through MCP; there is no MCP tool that publishes.
- **Test return value is enforced:** a test that returns exactly `false` fails. See A3.
- **Repo home** moves to `territorial-dev/sentinel`; RBMC becomes a fork under `paschendale`. The owner does the GitHub transfer after merge; this PR only updates URLs and writes the fork guide.
- Not in scope: maintenance windows, SLA reports, per-client status page branding, multi-user auth, browser tests.

## Design sources (in `handoff/design/`)

| File | Use |
| --- | --- |
| `brand-book.md` | Rules: vocabulary, writing, colour, type, layout, routes. Read first. |
| `tokens.json` | Every colour (dark, light), type style, spacing, radius, shadow, layout width. Exact values. |
| `bundle.css` | Reference CSS for all components (`sn-*` classes). Port to Tailwind theme + React components; class names need not survive. |
| `components.md` | Guidelines and reference markup for the 26 components. |
| `prototype.html` | Working prototype of every page on sample data. This is the target layout and behaviour for each screen. Open it in a browser (`#status`, `#tests`, `#incident-radar`, …). |
| `logo/` | Beacon mark, two inks. |

Live copies: design system https://claude.ai/artifact/DAh6vKTaFrwYZWp6JcCm2m, prototype https://claude.ai/artifact/UXNeXNiHqh3ENhRArU7uF6 (both readable with the Artifact tool on the owner's account). If the owner asked for changes after this note was written, the live copies win.

## Ground rules

- Read `RULES.md` and `.metaprompt` first; they bind. Notably: raw SQL in `db/queries/`, batch writes, no new dependencies without need, strict TS, optional env vars, MCP text updated with every capability change, an `IMPLEMENTATION_LOG.md` entry at the end.
- Conventional commits, one logical change each. **No AI attribution and no Co-Authored-By lines** in commits or the PR.
- Sentinel serves several clients. Everything must be generic; no client names in code, docs or examples.
- **Databases:** `apps/api/.env` may point at a live database. Never run migrations, tests or a dev server against it. For integration tests and manual runs, start a throwaway Postgres in Docker **on the host `disbelief` over SSH** (the owner's machines rule: no Docker on the Mac), named `sentinel-revamp-pg`, and remove it when done. Touch nothing else on that host.
- Local ports: 3001 is taken. API on `PORT=3101`, web with `pnpm dev -p 3100` and `API_URL` / `NEXT_PUBLIC_API_URL=http://localhost:3101`.
- Screenshots: headless Google Chrome works (`--headless=new --screenshot=… --window-size=1280,1500`). No Playwright.
- Fonts: load Inconsolata and Inter with `next/font/google` (self-hosted at build, no runtime request). No other new web dependency is expected. Markdown for incident reports: render a small safe subset by hand (paragraphs, lists, links, inline code) or propose a dependency to the owner; do not add one silently.

## Session A — backend

Audit references are `apps/api/src/…` at the commit this branch started from; re-locate by name if lines moved.

### A1. One definition of state (do this first)

`warn` currently means four things: `db/result-buffer.ts:124-131`, `routes/incident-policy.ts:27`, `routes/status.ts:301`, `db/aggregator.ts:74-75`. Put `isFailure(status)`, `publicStatusFor(...)` and the label maps (wire value → display word, for status, run result, section, event) in `packages/shared`, and use them everywhere, API and web. Remove the stale shared `TestState` type (`packages/shared/src/types.ts:124-130`) and the duplicated `formatDuration` / `iso` helpers.

### A2. Reliability

1. **Result buffer poison batch** (`db/result-buffer.ts:39-68`): chunk inserts by 100; on failure isolate and drop the rejected rows (log them) instead of requeueing the whole buffer; cap the buffer. A run whose test was deleted must not block later flushes. Shutdown must wait for an in-flight flush (`index.ts:25`).
2. **Notifier:** add request timeouts and consume response bodies (`notifier/dispatch.ts:297-318`, `channel-test.ts:23-42`); do not deliver candidates serially behind one hung webhook. A failed thread close must be retried: add a small reconciler that closes threads whose test is operational (`notifier/incidents.ts:198-201`). Replace `console.error` with the pino logger.
3. **Compile on save:** `POST`/`PATCH /tests` compile the code and return 400 with the syntax error. A test whose stored code does not compile records a failed run instead of only logging (`executor/run.ts:52`, `scheduler/index.ts:27-29`).
4. **Response body cap** in `doFetch` for `ctx.http`, `ctx.k8s`, `ctx.s3.list` (`executor/ctx.ts:410-417`), same cap mechanism as `s3.get`.
5. **Scheduler phase:** seed each test's first delay from `test_state.last_run_at` so a restart or PATCH does not push a 1 h test a full hour out (`scheduler/index.ts:41-47,72-75`).
6. **Public routes:** `routes/status.ts:293-320,370-382` query raw `test_runs` for unauthenticated requests. Add a short in-process TTL cache (30–60 s) keyed by the validated params, validate `after`/`before`/`period` (bad input is a 400, not a 500), and bound the work. Fix `ORDER BY finished_at` to use the indexed `started_at` (`routes/tests.ts:113,148`).
7. **`notification_events`:** stop inserting two rows per failing run (`dispatch.ts:107-134`); log transitions and deliveries only, batched.
8. **One error shape:** a Fastify `setErrorHandler` plus a helper so every route returns `{ error: string, details?: … }`. Keep existing success shapes and existing field names (`encryptionEnabled` stays).
9. **Run-now once:** one `runNow()` service used by `routes/run.ts` and `mcp/tools.ts`, respecting the overlap guard.
10. Remove dead code: `p-timeout` dependency, unused exports (`getLogs`, `slackApiCall`, `BOT_CHANNEL_TYPES`, the re-export at `notifier/incidents.ts:210`). Keep the `uses_browser` column and field (compat) but stop showing it.

Larger refactors the audit suggested (split `ctx.ts`, move all route SQL into `db/queries`) are welcome where a file is being touched anyway; they are not required for this PR.

### A3. Enforce the return value

`executor/run.ts:110-113` discards the function's result. New rule: **a return value of exactly `false` fails the run** with message `returned false`; `true`, `undefined` and anything else pass; throws and failed assertions fail as today. Update every statement of the contract to match ("return false or throw to fail"): README, `docs/`, `mcp/tools.ts:67`, the MCP instructions, the editor hint. Add tests for `return false`, `return true`, no return, and a rejected promise.

Risk the owner accepted: tests that already return a falsy comparison start failing after deploy. Add to the PR description a one-liner the operator can run before upgrading (`GET /tests/export`, list tests whose code contains a `return` of an expression) so they can review them.

### A4. Bulk actions

`POST /tests/bulk` with `{ ids: string[], action: 'enable' | 'disable' | 'run' | 'delete' | 'add_tag' | 'remove_tag', tag?: string }`, one transaction, returns per-id results. Matching MCP tool `bulk_update_tests`. Existing single-test routes unchanged.

### A5. Stored incidents

Today incidents are recomputed per request from the last 500 runs (`routes/tests.ts:131-155`, `routes/incident-policy.ts`) and vanish with run retention. `test_state.problem_*` holds only the latest window. `notification_threads` keys on `last_status` transitions, not `public_status`.

**Migration `021_incidents.sql`** (additive):

- `incidents`: id, title, severity (`down` | `degraded`, worst seen), state (`investigating` | `identified` | `monitoring` | `resolved`), started_at, resolved_at, published_at (null = internal), group_key (nullable), snapshot columns filled at resolve (duration_ms, failed_runs), created_at, updated_at.
- `incident_tests`: incident_id, test_id (nullable on test delete, keep `test_name`), started_at, ended_at, worst status.
- `incident_updates`: id, incident_id, created_at, kind (`system` | `note`), body, author (`user:<name>` | `token:<label>` | `system`), public boolean default false.
- `incident_reports`: incident_id (pk), five sections × two versions (internal, public) as text, published_at.
- `notification_threads.incident_id` and `notification_events.incident_id`, nullable.

**Opening and closing.** The upsert CTE in `db/result-buffer.ts:118-171` already computes `prev_public_status → public_status` and discards it. Add `RETURNING`, and in the same transaction:

- when a test enters `down` (threshold reached): join the open incident with the same `group_key`, else open one. `group_key` is the value of an optional `incident:<group>` tag on the test; a test without one gets its own incident. Default title: the test name plus "outage". Write a system update.
- when a linked test changes state: system update; raise severity if worse.
- when every linked test is back to `up`: set `resolved`, fill the snapshot, system update.
- A test that only goes `degraded` joins an already-open incident of its group but does not open one.

Hand the notifier `{ incident_id, transition }` so thread open/close follows the same transitions. Add the reconciler from A2.2 for incidents too (resolve incidents whose tests are all operational).

**Routes (signed-in):** `GET /incidents?state=open|resolved|all`, `GET /incidents/:id` (tests, updates, report), `PATCH /incidents/:id` (title, state), `POST /incidents/:id/tests`, `POST /incidents/:id/updates` (`{ body, public }`), `PUT /incidents/:id/report`, `POST /incidents/:id/publish`, `POST /incidents/:id/unpublish`, `POST /incidents/:id/report/publish`.

**Publishing is for a person.** Check how `/auth/login` tokens and `/auth/mcp-token` tokens differ (`routes/auth.ts`). If they are distinguishable, reject publish/unpublish and `public: true` notes from MCP tokens with 403; if not, add a claim to newly issued MCP tokens and treat tokens without it as login tokens (no break for existing sessions). Record what you did in the notes below.

**Public routes (no auth, cached like A2.6):** `GET /status/incidents?tag=` (published only; open ones and the last 30 days) and `GET /status/incidents/:id` (title, state, times, affected test names, public updates, the public report if published). Never return internal text.

**MCP tools:** `list_incidents`, `get_incident`, `add_incident_note` (always internal), `set_incident_state`, `link_incident_test`, `draft_incident_report`. No publish tool. Update the server `instructions`.

**Compat:** `GET /tests/:id/incidents` and the `get_test_incidents` tool keep their current response shape; back them with stored incidents where they exist and the old derivation for older history.

### A6. Tests

Unit tests for A1, A2.1, A2.3, A3, incident open/join/resolve, publish permission, the public incident routes (no internal text leaks), bulk. Run `pnpm -r typecheck` and the API test suite (integration tests against the throwaway Postgres).

## Session B — web

The prototype is the spec for layout and behaviour; `components.md` for each component's rules; `tokens.json` for values. Where the prototype and the real data model disagree, keep the prototype's layout and use the real data.

### B1. Foundations

- Tailwind theme extended from `tokens.json` via CSS variables in `globals.css`: dark values on `:root`, light under `prefers-color-scheme: light` guarded by `:root:not([data-theme="dark"])`, and again under `:root[data-theme="light"]`. No raw `zinc-*`, `red-*`, `emerald-*`, `yellow-*`, `indigo-*`, `amber-*` classes or hex colours remain in `apps/web` when done (the two chart components hard-code hex today).
- Fonts through `next/font/google`; `--font-mono`, `--font-sans`.
- Component library in `apps/web/app/_components/ui/` named as in `components.md` (Button, SegmentedControl, Tag, StatusIndicator, StatusBanner, HistoryStrip, SectionHeader, TestTable, StatusCard, DefinitionGrid, CodeBlock, LatencyChart, Field, SearchAndBulk, Dialog, Callout, EmptyState, IncidentBanner, IncidentState, IncidentTimeline, IncidentReport, ChannelRouting, Logo, AppHeader, PublicHeader, PageHeader). Server Components by default.
- Theme switch on public pages (Light / Dark / System, stored in `localStorage`, applied before paint to avoid a flash).
- Every data-fetching page shows the outage Callout when the API request fails; today a failed fetch renders as an empty list.

### B2. Routes

| New | Was | Notes |
| --- | --- | --- |
| `/` | `/status` | Public status page. No sign-in redirect. |
| `/status`, `/status/[slug]`, `/status/tests/[id]` | same | Keep working. `/status` may render the same page as `/`. |
| `/status/incidents/[id]` | — | Public incident page; 404 when not published. |
| `/admin` | `/login` | Sign-in. Signed in → redirect to `/admin/tests`. |
| `/admin/tests` | `/` | Dashboard. |
| `/admin/tests/new`, `/admin/tests/[id]`, `/admin/tests/[id]/edit` | `/tests/…` | |
| `/admin/incidents`, `/admin/incidents/[id]` | — | |
| `/admin/notifications` | `/notifications` (and `/channels`) | |
| `/admin/secrets` | `/secrets` | |
| `/admin/tokens` | `/tokens` | Nav label "API tokens". |

`middleware.ts`: only `/admin/*` (except `/admin` itself) requires the cookie; unauthenticated → `/admin`. Old signed-in paths (`/login`, `/tests/*`, `/notifications`, `/channels`, `/secrets`, `/tokens`) redirect permanently to their `/admin` equivalents. Use a route group layout for `/admin` that renders AppHeader once; public pages get PublicHeader and the footer. Public pages carry no link to `/admin`. Add Sign out.

### B3. Pages

Rebuild each to match the prototype:

- **Public status** (`/`, `/status/[slug]`): StatusBanner, published open incidents, chips, sections with grid or list, period and view switches, UTC / Local switch, "Incidents in the last 30 days", footer. Operational is expanded on public pages; Paused tests are not shown.
- **Public check** and **public incident** pages.
- **Tests dashboard:** search (`?q=`, `/` focuses, `Esc` clears), tag filters, chips, sections with the table, row selection and the bulk bar wired to `POST /tests/bulk`, incident chip on rows in an open incident.
- **Test page:** PageHeader, open-incident callout, configuration (drop "Uses browser"), notifications with their source tag, code, chart, recent runs with the run-result words, incidents.
- **Editor:** two columns (fields, Monaco), field hints, server-side compile error shown under the editor, Monaco themed from the tokens for both themes and still dynamically imported.
- **Incidents list and incident page:** state stepper, publish/unpublish with Dialog, affected tests, timeline with composer and "Show on status page", report with Internal / Public versions, an editor per section, publish report with Dialog.
- **Notifications:** channels list, routing by tag with spelled-out event toggles; channel type as a neutral Tag; deletes through Dialog.
- **Secrets**, **API tokens:** as in the prototype; the tokens page explains MCP and shows the connect command once.
- **Sign-in** at `/admin`.

Keep the 60 s auto-refresh on public pages and the existing URL parameters (`period`, `view`, `tag`).

### B4. Checks

`pnpm -r typecheck`, `next build`, then screenshots of every page in dark and light at 1280 and 400 wide against the throwaway database with a few seeded tests. Compare with the prototype. No horizontal page scroll at 400.

## Session C — words, docs, wrap-up

1. **Vocabulary sweep** outside the web app: notification messages (`notifier/payloads.ts:35-37` "is DOWN / back UP / DEGRADED" → Outage / Recovered / Degraded wording; keep JSON webhook field names and values), email text, MCP `instructions` and tool descriptions (`routes/mcp.ts`, `mcp/tools.ts`: mention bot channels, email, incidents, bulk, return-value rule; fix the hard-coded version `1.0.0`), UI strings missed in B. One name per thing, per the table in `brand-book.md`.
2. **Docs restructure** (target):
   - `README.md` about 150 lines: what it is, features, quickstart, links, license.
   - `docs/guide/writing-tests.md`: the single `ctx` reference (today it exists four times: README, DOMAINS, `mcp.ts`, `tools.ts`); MCP text is a condensed copy.
   - `docs/guide/notifications.md`, `docs/guide/status-and-incidents.md` (state model and glossary: run result → state → section → event → incident), `docs/guide/deployment.md` (complete env table including `RESEND_*`, retention, FTP sweep, `SLACK_API_URL`/`DISCORD_API_URL`; `/health`; metrics).
   - `docs/reference/api.md`: every REST route, auth, MCP setup and tools.
   - `docs/dev/ARCHITECTURE.md` (absorbs `REPOSITORY.md` and the dependency list, corrected), `docs/dev/DOMAINS.md` (entities only), `docs/dev/DESIGN.md` (tokens, components, the rules from `brand-book.md`, link to the design system), `docs/dev/IMPLEMENTATION_LOG.md` (moved; add this PR's entry).
   - `CONTRIBUTING.md`: merges `RULES.md` and `.metaprompt`, written for agents first (Sentinel is developed by agent workflow: how to brief an agent, the checks to run, the MCP-text rule). Keep `RULES.md` and `.metaprompt` as short pointers so existing agent setups still find them.
   - `docs/FORKING.md`: fork to build on Sentinel; restyle by editing token values; where to add a `ctx` protocol, a page, a migration (number range reserved for forks), how to pull from upstream. Use the RBMC station monitor as the example of what a fork adds, without client detail.
   - `ROADMAP.md` replaces `PROJECT.md` (open items only).
   - Fix known drift while moving text: `ctx.http` has only get/post; cooldown default is 86 400 000; aggregated retention default 90 days; channel types include email and bots; public status behaviour as now implemented (update RULES 10 and 23 to the cached approach); remove the Playwright/browser-queue claims; `sentinel_check_success_total`; tool count; `docs/FEATURES.md` reference; rename `LICENSE-COMERCIAL.md` to `LICENSE-COMMERCIAL.md`.
3. **Repo home:** replace `paschendale/sentinel` with `territorial-dev/sentinel` in README, docs, badges, `outbound-headers.ts` User-Agent URL, compose files and workflows. Leave `CHANGELOG.md` history alone.
4. **Final verification:** typecheck, tests, build, a last screenshot pass, `git grep` for leftover old words in UI strings and for `handoff/`.
5. **Delete `handoff/`** in the last commit. Push, open one PR to `main` titled `feat: design system, admin rework, incidents and reliability pass` with: summary by area, the compat statement, the return-value upgrade note (A3), migration `021`, screenshots, and a post-merge checklist for the owner (transfer the repo to `territorial-dev`; fork it to `paschendale` and move `rbmc` there; redeploy the three instances; review tests flagged by the A3 one-liner).

## Progress

Tick when done; add one line of notes if the next session needs to know something.

- [x] A1 shared state and labels
- [x] A2 reliability (1–10)
- [x] A3 return value
- [x] A4 bulk
- [x] A5 incidents
- [x] A6 tests green
- [x] B1 foundations
- [x] B2 routes
- [x] B3 pages
- [x] B4 checks
- [ ] C1 vocabulary
- [ ] C2 docs
- [ ] C3 repo URLs
- [ ] C4 verification
- [ ] C5 handoff deleted, PR opened

### Notes between sessions

Session A (done; last run 36 test files, 300 tests green, typecheck clean):
- Tests: never run vitest on the Mac (`src/test/global-setup.ts` loads `apps/api/.env`). On disbelief: `~/work/sentinel-revamp` (rsync the tree there, no `.env`), Postgres container `sentinel-revamp-pg` (user/db `sentinel`/`sentinel_test`, matches `vitest.config.ts`, so integration tests run instead of skipping), runner script `~/work/sentinel-revamp-test.sh` runs typecheck + migrations + tests in `node:22-bookworm` sharing the PG network. Remove the container, the `sentinel-revamp-pnpm` volume and `sentinel-revamp-net` network when the PR is done. Last run: 35 files, 291 tests green.
- A1: `packages/shared/src/state.ts` holds isFailure/publicStatusFor/periodOutcome/uptimePct, label maps (STATE/RUN_RESULT/SECTION/EVENT/INCIDENT_STATE), formatDuration ("2 h 27 min"), toIso, TEST_RESULT_CONTRACT. A warned run is neither success nor failure: migration `022_uptime_warn_count.sql` adds `uptime_daily.warn_count`; buckets now return `warn_count` and `failure_count` excludes warns. B must colour buckets/days from warn_count too and use the label maps for every state word.
- A2: result buffer rewritten (chunked transactions; `upsertTestState` already returns per-test transitions with prev_public_status → public_status, ready for A5 incident open/close in the same transaction in `writeChunk`). Reconciler in `notifier/reconciler.ts` (threads only so far; A5 adds incidents). Error shape helper `routes/errors.ts`. `runNow()` in `executor/run-now.ts` (409 when busy). Public /status cache in `routes/public-cache.ts` (reuse for /status/incidents). CORS allow-methods in server.ts lacks PUT: add it with `PUT /incidents/:id/report`.
- A3: no `BREAKING CHANGE` footer on purpose (merge commits would make semantic-release cut 2.0.0); the upgrade note belongs in the PR description.
- A4: `POST /tests/bulk` → `{ action, results: [{ id, ok, error?, started? }] }`; MCP tool count is 23.
- A5 auth: login tokens carry `sub: 'admin'`, MCP tokens `sub: 'mcp'` (now with an optional `label` in `POST /auth/mcp-token`), so no new claim was needed. `auth/principal.ts` puts `request.principal` (`person` | `token`, author `user:<ADMIN_USERNAME>` / `token:<label>`) on every authed request; tokens without `sub: 'mcp'` are a person. Publish, unpublish, report publish and `public: true` notes return 403 to tokens.
- A5 API for B (all signed in unless noted): `GET /incidents?state=open|resolved|all` (default all) → `IncidentListItem[]` with `tests` and `report_state`; `GET /incidents/:id` → `IncidentDetail` (tests, updates, report with `sections[summary|impact|root_cause|resolution|follow_ups].internal/public`); `PATCH /incidents/:id {title?, state?}`; `POST /incidents/:id/tests {test_id}`; `POST /incidents/:id/updates {body, public}`; `PUT /incidents/:id/report` (partial, per section and version); `POST /incidents/:id/publish|unpublish`; `POST /incidents/:id/report/publish` (400 when no public text). Public, no auth, cached 30 s: `GET /status/incidents?tag=` and `GET /status/incidents/:id` → `PublicIncident` (404 unless published). Types and zod schemas in `packages/shared/src/incidents.ts`; `REPORT_SECTION_LABELS`, `INCIDENT_STATE_LABELS`, `incidentGroupOf()`.
- Incident chip on dashboard rows (B3): not in `GET /dashboard` yet; fetch `GET /incidents?state=open` and match `tests[].test_id`.
- Migrations in this PR: `021_incidents.sql` and `022_uptime_warn_count.sql` (C: mention both in the PR description).
- For the PR description (C5), the A3 pre-upgrade check: `curl -s -H "Authorization: Bearer $TOKEN" $API/tests/export | jq -r '.tests[] | select(.code | test("return\\s+[^;\\n]*(===|!==|==|!=|<|>|&&|\\|\\||!)")) | .name'` lists tests that return an expression which could be `false`.
- Error bodies are now always `{ error: string, details? }`; validation errors put the zod breakdown in `details` (the web's channel form already reads `error` as a string).
- `IMPLEMENTATION_LOG.md` has the Session A entry (C moves the file to `docs/dev/`).

Session B (done; typecheck clean, `next build` green, screenshots of every page in dark and light at 1280 and 400, no horizontal scroll):
- Layout: `apps/web/app/styles/tokens.css` (the values a fork edits) and `components.css` (`sn-*` classes ported from bundle.css); the React library is `apps/web/app/_components/ui/` with a barrel `index.ts`. Tailwind's palette is replaced by the tokens. Routes: `app/(public)/…` for `/` and `/status/…`, `app/admin/page.tsx` sign-in, `app/admin/(app)/…` for everything signed in, `app/admin/signout/route.ts`. Redirects in `next.config.ts`.
- Word mapping for the web lives in `apps/web/lib/states.ts` (kinds, section titles/descriptions, event labels) on top of the shared label maps. Formatting (times "18:43 UTC", "2 h 27 min", uptime with one decimal) in `lib/format.ts`. C: if notification messages need the section descriptions, lift them into shared.
- New optional env var `STATUS_PAGE_TITLE` (web server, read at request time; default "Service status"). C2: add it to the deployment env table and the compose examples.
- `uptimePct(success, warn, failure, digits = 0)` in shared now takes decimals and never returns 100 while a run failed (so 999/1000 is 99, not 100); API callers keep whole percents. Test added in `state.test.ts`.
- C1 words still to fix outside the web: `ctx.assert` is `ctx.assert(name, value, message?)`, but `components.md` (CodeBlock) and the prototype show `ctx.assert(cond, msg)`; use the real order in docs. The public footer links `github.com/paschendale/sentinel` (`app/_components/ui/public-header.tsx`): C3 changes it.
- Public check pages no longer show recent runs or error messages (brand book: public text has no error messages). `GET /status/test/:id/events` is unused by the web now; it stays for compatibility.
- Throwaway stack on disbelief for screenshots: API container `sentinel-revamp-api` (port 100.90.83.39:3101, DB `sentinel_dev` in `sentinel-revamp-pg`, admin/admin) with seeded tests and incidents. Web locally: `API_URL=NEXT_PUBLIC_API_URL=http://100.90.83.39:3101 pnpm dev -p 3100`. Remove `sentinel-revamp-api` with the other revamp containers at the end of C.
