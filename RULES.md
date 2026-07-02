# Sentinel — Rules for AI Agents & Contributors

These rules are non-negotiable. They exist because of hard constraints (1GB RAM, 0.5 vCPU) and deliberate design decisions. Do not work around them.

---

## Before You Touch Code

1. **Read `docs/ARCHITECTURE.md`** before modifying anything in `apps/api/src/executor/`, `apps/api/src/scheduler/`, or `apps/api/src/db/`.
2. **Read `docs/DOMAINS.md`** before adding or changing any database schema or entity types.
3. **Read `docs/FEATURES.md`** to understand what is in scope before adding new functionality.

---

## Dependencies

4. **No new dependencies without checking the approved list** in `docs/ARCHITECTURE.md`. The approved list is intentionally short.
5. **Banned packages**: `axios`, `express`, `redis`, `bullmq`, `prisma`, `typeorm`, `sequelize`, `lodash`, `moment`. Do not add these.
6. **No new packages that import native bindings** (`.node` files) without explicit user approval — they complicate deployment.

---

## Database

7. **Raw SQL only** — no ORM, no query builder, no `knex`, no `drizzle`. All SQL lives in `apps/api/src/db/queries/`.
8. **Batch writes** — never `INSERT` individual rows in a loop. Buffer results and flush in batches of 50–100.
9. **Connection pool max is 5** — do not increase this without understanding the RAM implications.
10. **Public dashboards query `uptime_daily` only** — never query raw `test_runs` in any route used by the public status page.
11. **Migrations are plain SQL files** — no migration framework. Number them sequentially: `001_init.sql`, `002_add_field.sql`.

---

## Execution Engine

12. **Event loop must never block** — no `fs.readFileSync`, no `JSON.parse` on large payloads in hot paths, no CPU-heavy loops.
13. **All test execution must use `Promise.race` with a timeout** — never `await` user code without a timeout guard.
14. **User code gets only the `ctx` object** — no `require`, no `import`, no `process`, no `__dirname` in user test functions.
15. **Compile user code once on save** via `new Function('ctx', code)` and cache — do not recompile on every run.
16. **Startup/cache-warming code must never let one bad row crash the whole process** — if you load a collection of DB rows into an in-memory cache at startup (compiled functions, decrypted secrets, etc.), catch failures per-item, log loudly, and skip that item. One corrupt or unparseable row must not take down the entire API — verify this by actually restarting the process with deliberately-broken state, not just by unit-testing the parsing function in isolation.

---

## Notifications

17. **Notifications are fire-and-forget** — wrap all notification dispatches in `try/catch`, never `await` them in the test execution path.
18. **Alert on state transitions only** — do not fire a notification if the status hasn't changed.
19. **Respect the failure threshold and cooldown** — check `consecutive_failures >= threshold` and `cooldown elapsed` before firing.

---

## Frontend

20. **Monaco Editor must be dynamically imported** — never include it in the initial bundle. Use `next/dynamic` with `ssr: false`.
21. **No heavy UI component libraries** — no MUI, Chakra, Mantine. Use Tailwind or plain CSS modules.
22. **Server Components by default** — use Client Components only where browser interactivity is required. Minimize client JS.
23. **Public status pages are static** — use `generateStaticParams` + ISR. Never fetch from the API at request time on public routes.

---

## Code Style

24. **TypeScript strict mode** — no `any`. Use `unknown` and narrow explicitly.
25. **No barrel `index.ts` re-exports** inside `apps/api/src/` — import directly from the source file.
26. **File names in `kebab-case`** — e.g., `test-executor.ts`, not `testExecutor.ts`.
27. **Environment variables are loaded once** in `apps/api/src/config.ts` — do not call `process.env` elsewhere.
28. **New environment variables should be optional, not required**, unless there is truly no safe default. A newly-required env var breaks every existing deployment on upgrade until an operator notices and sets it. Default to `optionalEnv(...)` and degrade gracefully (e.g. a feature runs in a less-secure or reduced mode, with a logged/UI warning) when the var is unset. Only fail fast when a value is *present but malformed* — never merely because it's absent.

---

## Commits

29. **Use conventional commits** — format: `<type>(<scope>): <description>`. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`. Scopes: `api`, `web`, `shared`, `db`, `scheduler`, `executor`, `notifier`.
30. **One logical change per commit** — do not batch unrelated changes into a single commit.

---

## After Finishing Work

31. **Update `IMPLEMENTATION_LOG.md`** — append an entry with: what was built, files changed, decisions made, anything deferred. See `.metaprompt` for the exact format. This is mandatory, not optional.

---

## What to Check Before Submitting

- [ ] Does this introduce a new dependency? Is it on the approved list?
- [ ] Does this write to the DB? Is it batched?
- [ ] Does this run user code? Is there a timeout?
- [ ] Does this add a client-side import in Next.js? Is it dynamically imported?
- [ ] Does this query `test_runs` from a public route? It shouldn't.
- [ ] Does this add a new environment variable? Could it be optional instead of required?
- [ ] Does this load rows into an in-memory cache at startup? Does one bad row degrade gracefully instead of crashing the process?
- [ ] Has `IMPLEMENTATION_LOG.md` been updated?
