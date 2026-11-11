# Status and incidents

How Sentinel turns runs into the words people read, how the public status page shows them, and how incidents are opened, written up and published.

The words below are the only ones Sentinel uses for these things, in the UI, in notifications, in MCP text and in these docs. The wire values (in code font) are what the API stores and returns; they never change. The mapping lives once, in `packages/shared/src/state.ts`.

## Glossary

From the smallest unit to the largest:

| Level | Word people read | Wire value | Means |
| --- | --- | --- | --- |
| Run result | Passed | `success` | The test returned anything but `false` and did not throw |
| | Warned | `warn` | It passed but called `ctx.warn()` |
| | Failed | `fail` | It threw, failed a `ctx.assert` or returned exactly `false` |
| | Timed out | `timeout` | It ran past `timeout_ms` |
| State of a test | Operational | `up` | The last run passed |
| | Degraded | `degraded` | It warned, or it is failing but still under its failure threshold |
| | Outage | `down` | Consecutive failures reached `failure_threshold` |
| | No data | `unknown` | No runs yet |
| | Paused | `enabled: false` | Not scheduled |
| Section | Outage, Degraded, Recovered, Operational, Paused | `critical`, `warning`, `recovered`, `clean`, `disabled` | Where a test is listed |
| Notification event | Outage, Degraded, Recovered | `fail`, `warning`, `recovery` | What a channel is told |
| Incident | Investigating, Identified, Monitoring, Resolved | `investigating`, `identified`, `monitoring`, `resolved` | A stored outage with a timeline and a report |

Run results appear only in a test's run history. Everywhere else a test has a state.

## Run results

How a test function decides its result is in [Writing tests](writing-tests.md). In short: throw, fail a `ctx.assert`, or return exactly `false` to fail; `ctx.warn()` makes a passing run Warned; a run over `timeout_ms` is Timed out.

Failed and Timed out are failures (`isFailure()`). Warned is not: it resets the failure streak and counts as available in uptime.

## States

After every run Sentinel updates the test's state (`test_state.public_status`), in the same statement that records the run:

- **Operational** when the run passed.
- **Outage** when it failed and the streak of consecutive failures has reached the test's `failure_threshold`.
- **Degraded** otherwise: the run warned, or it failed but the streak is still under the threshold.

Degraded covers those two cases. The dashboard says which in the "since" line rather than with another word: "1 of 3 failures" for a failure under the threshold, the warning text for a warning.

### The status window

An instance can set `STATUS_WINDOW_MINUTES` (off by default) for checks that flap, where a short failure should not page anyone. With a window:

- **Outage** also needs the test to have been failing for the whole window, counted from the first failed run of the streak. Until then it is Degraded.
- After any trouble, a passing test stays **Degraded** until it has passed for the whole window, counted from the first passing run. Then it is Operational.

Alerts and incidents follow these states, so with a 60-minute window an Outage alert means "failing for over an hour" and the Recovered alert means "passing for over an hour". The streak starts are stored in `test_state.failing_since` and `succeeding_since`.

**Recovered** is not a stored state: it is an Operational test whose last problem (a run that did not pass) is less than 24 h old.

## Sections

The dashboard and the status page stack tests in sections, top to bottom:

| Section | Wire key | Holds | Order inside |
| --- | --- | --- | --- |
| Outage | `critical` | State Outage | Newest problem first |
| Degraded | `warning` | State Degraded | Newest problem first |
| Recovered | `recovered` | Operational, a non-passing run in the last 24 h | Most recent recovery first |
| Operational | `clean` | Operational (or No data), every run in 24 h passed | By name |
| Paused | `disabled` | Not scheduled, whatever its last state | By name |

The section comes from the same state the notifier acts on (`statusSection()` in `packages/shared/src/sections.ts`), so the dashboard, the status page and the channels never disagree. Tags play no part.

### The "since" line

Each test carries a problem window: when the current (or last) streak of non-Operational state started, when it ended, and the worst state it reached. The dashboard turns it into a line such as "failing for 2 h 27 min · since 18:43 UTC", "1 of 3 failures" or "recovered 5 h ago · was down 25 min". Times are UTC; durations use `h`, `min`, `s`, `d`.

## Uptime

Uptime is the share of runs that did not fail: Passed and Warned runs count as available, Failed and Timed out runs do not. It is never rounded up to 100% while any run failed, so "100%" always means no failures (999 of 1000 reads 99.9%, not 100%). Daily counts are kept in `uptime_daily` (`success_count`, `warn_count`, `failure_count`).

## The public status page

The status page is the landing page. It needs no sign-in and carries no link to `/admin`.

| Path | Shows |
| --- | --- |
| `/` (also `/status`) | Every check |
| `/status/[tag]` | The checks carrying that tag |
| `/status/tests/[id]` | One check: state, history, uptime |
| `/status/incidents/[id]` | One published incident; 404 when it is not published |

Public pages call a test a check. They show:

- a banner with the overall state, then the published open incidents;
- count chips and the sections Outage, Degraded, Recovered and Operational, with Operational expanded. Paused checks are not shown;
- a history strip per check, for a period of 1 h, 24 h, 7 d or 30 d, in a grid or a list;
- "Incidents in the last 30 days";
- a UTC / Local switch for times and a Light / Dark / System theme switch, remembered in the browser.

Public text never includes hostnames, error messages, test code or people's names. The page title is `STATUS_PAGE_TITLE` (optional, default "Service status"). The page refreshes itself every 60 s and keeps its `period`, `view` and `tag` URL parameters.

### Public API and caching

The web app renders public pages per request from the API's public routes (`GET /status…`, listed in the [API reference](../reference/api.md#status-page-public)). Those routes need no auth, so they are built to take traffic:

- Every reply is held in an in-process cache for 30 s, keyed by its validated parameters, with at most 500 keys. Concurrent misses for one key share one query.
- Parameters are validated: an unknown `period` is a 400, over-long tags or ids are rejected, the event `limit` is capped at 50.
- Work is bounded: a bucket query covers at most 500 tests.
- The 30 d history reads the daily aggregates (`uptime_daily`). The 1 h, 24 h and 7 d histories read `test_runs` in 100 equal buckets, which the cache keeps to one query set per key per 30 s.
- Writes that change what the public sees (publishing, public notes) clear the cache.

## Incidents

An incident is a stored outage: the tests it affected, a timeline and a written report. Incidents stay **Internal** until a signed-in person publishes them.

### Opening, joining and resolving

Sentinel manages incidents itself, in the same transaction that records the runs:

- **Opening.** When a test reaches Outage and is not already in an open incident, it joins the open incident of its group, or opens a new one. The group is the value of an optional `incident:<group>` tag; a test without one gets its own incident. A new incident is titled "<test name> outage", starts in Investigating and gets a system entry ("Opened: <test> is in Outage (3 failures).").
- **Joining.** A test that is only Degraded joins an already open incident of its group, but never opens one.
- **Changes.** When a linked test changes state, a system entry records it and the incident's severity rises if the new state is worse (severity is the worst state seen: `down` or `degraded`).
- **Resolving.** When a linked test is Operational again its link ends. When no linked test is still in trouble, the incident moves to Resolved and keeps a snapshot of its duration and failed runs, so the numbers outlive run retention.

A reconciler runs every 5 min as a backstop: it ends the links of tests that are Operational or paused, resolves open incidents left without an affected test (including ones whose tests were all deleted), and closes bot-channel threads left open after a recovery.

### States

Investigating, Identified, Monitoring, Resolved. Sentinel sets Investigating and Resolved itself. A person or an agent sets Identified once the cause is known and Monitoring once a fix is out. Resolving by hand ends every link; moving a resolved incident back reopens it. Each change writes a timeline entry.

### Timeline

The timeline holds system entries written by Sentinel and notes written by people and agents. A note is Internal unless the person writing it ticks "Show on status page". Public notes appear on the status page once the incident is published. Authors are recorded as `user:<name>`, `token:<label>` or `system`.

### Report

The report has five sections: Summary, Impact, Root cause, Resolution, Follow-ups. Each has an Internal and a Public version, written in a small Markdown subset (paragraphs, lists, links, inline code). Saving a report changes only the sections and versions sent. The report stays a draft until it is published.

### Publishing

Publishing is for a person:

- Publishing or unpublishing an incident, adding a public note and publishing the report need a sign-in session. Agent (MCP) tokens get 403.
- Agents can read incidents, add internal notes, set the state, link tests and draft the report. No MCP tool publishes.
- A report can be published only once it has public text.

The status page shows published incidents that are open or started in the last 30 days. A published incident's page shows its title, state, times, the names of the affected checks, the public notes and, once published, the public report. Internal text never leaves the signed-in side.

### Compatibility

`GET /tests/:id/incidents` and the MCP tool `get_test_incidents` keep their older shape: time windows (start, end, duration, failed runs, ongoing) for one test, from stored incidents where they exist and from the retained runs for older history.

## See also

- [Writing tests](writing-tests.md)
- [Notifications](notifications.md)
- [API reference](../reference/api.md)
- [Domain model](../dev/DOMAINS.md)
