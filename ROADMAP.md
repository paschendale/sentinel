# Roadmap

Open work only. Finished work is in the [changelog](CHANGELOG.md) and the [implementation log](docs/dev/IMPLEMENTATION_LOG.md). To pick something up, write a brief as described in [CONTRIBUTING.md](CONTRIBUTING.md#briefing-an-agent).

## Next

- **API test coverage to 90%.** Lines and statements in `apps/api`, then a coverage threshold in `vitest.config.ts` so CI fails below it. Weakest areas last measured: routes, notifier transports, `db/queries`.
- **Per-token revocation.** API tokens can only be invalidated all at once by rotating `JWT_SECRET`, which also signs everyone out. Store issued token IDs and labels, list them on the API tokens page, and revoke one.
- **Split `executor/ctx.ts`.** One file per protocol (`ctx-http.ts`, `ctx-s3.ts`, `ctx-k8s.ts`, `ctx-ftp.ts`) behind the same `TestContext`. Makes forks that add a protocol touch less shared code.
- **Route SQL into `db/queries/`.** Some routes (`status.ts`, `tests.ts`, `dashboard.ts`) still hold SQL inline.
- **Open incident on dashboard rows from the API.** `GET /dashboard` could return each test's open incident id, so the dashboard does not need a second request.

## Later

- **Rate limits on bot channels.** A Slack or Discord 429 is logged as a failed thread update and retried only at the next evaluation; honour `Retry-After` instead.
- **Secret key rotation.** Re-encrypt every secret and bot token under a new `SECRETS_ENCRYPTION_KEY` without rotating each value by hand.
- **Attempt history.** Record each retry attempt, not only the last, so a run that passed on its second attempt shows it.
- **Per-test request headers.** An optional `X-Sentinel-Test-Id` on outbound requests so a monitored service can tell which test called it.
- **Several locations.** Instances already name themselves with `SENTINEL_INSTANCE`; aggregating results from several on one status page is not designed yet.
- **Maintenance windows and SLA reports.** Scheduled windows that pause alerting and mark the status page; monthly uptime reports per tag.

## Not planned

- **Browser tests.** The `uses_browser` field stays in the API for compatibility and does nothing. Sentinel's memory budget has no room for a browser.
- **Theming or branding in the UI.** Customisation comes from forks editing token values ([FORKING.md](docs/FORKING.md)).
- **Multi-tenant SaaS.** Sentinel is self-hosted, one operator and their agents. Multi-user sign-in may come later; tenants will not.
- **Replacing Prometheus or an APM.** Sentinel feeds metrics to existing stacks and does not trace requests.
- **A no-code test builder.** Tests are JavaScript.
