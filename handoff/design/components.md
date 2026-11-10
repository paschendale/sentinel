## AppHeader

The one header for every signed-in page (everything under `/admin`), rendered by the admin layout.

Today the nav is copied into four pages and missing from the test page, the editor and both forms; this replaces all of them.

- **Order:** Tests, Incidents, Notifications, Secrets, API tokens, Status page. "Status page" opens the public page and carries `↗`.
- **Current page:** `aria-current="page"`; `fg` text with a 2px `accent` underline. This and the logo are the only places `accent` appears in the shell.
- **Incidents count:** shown only while incidents are open, in `outage` on `outage-tint`.
- **Right side:** Sign out and one primary button, "New test". Search lives on the Tests page, not in the header. No other primary button sits in the header.
- Labels are sentence case, not the old lowercase links. "mcp" becomes "API tokens"; the page explains MCP.
- Below 640px the nav wraps under the brand; nothing collapses into a menu.

The consumer provides the current route and the open-incident count.

```html
<body class="sn-preview sn">
<header class="sn-appbar"><a class="sn-brand" href="#"><svg class="sn-logo" viewBox="0 0 64 64" height="28" width="28" aria-hidden="true"><path class="ink" d="M6 46 32 34 58 46 32 58Z"/><path class="ink" d="M32 46V22"/><circle class="dot" cx="32" cy="18" r="3.2"/><path class="sig" d="M38.36 11.64A9 9 0 0 1 38.36 24.36M25.64 11.64A9 9 0 0 0 25.64 24.36"/><path class="sig2" d="M42.61 7.39A15 15 0 0 1 42.61 28.61M21.39 7.39A15 15 0 0 0 21.39 28.61"/></svg>sentinel</a>
<nav class="sn-nav" aria-label="Main"><a href="#" aria-current="page">Tests</a><a href="#">Incidents<span class="sn-nav__count">1</span></a><a href="#">Notifications</a><a href="#">Secrets</a><a href="#">API tokens</a><a href="#">Status page ↗</a></nav>
<button class="sn-btn sn-btn--ghost sn-btn--sm" type="button">Sign out</button>
<a class="sn-btn sn-btn--primary" href="#">New test</a></header>
```

## Button

The four buttons: primary, secondary, ghost and danger, in two sizes.

- **Primary** (`primary` fill): the one action that completes the page. At most one per view.
- **Secondary** (`border-strong` outline): other real actions: Run now, Add note, Send test message.
- **Ghost** (text in `fg-muted`): Cancel, Edit, Hide, and row-level actions.
- **Danger** (`outage` text and outline): Delete, Revoke. Always confirmed in a Dialog.
- **Small** for actions inside rows and section headers.
- Labels are a verb and an object in sentence case: "Save test", "Publish report". While working, the label changes ("Saving…") and the button is disabled.
- All buttons are `radius-sm`. Today's buttons have no radius, inputs none, pills 2px; everything becomes 2px.
- Focus shows a 2px `accent` ring, offset 2px.

```html
<body class="sn-preview sn">
<div class="sn-stack"><div class="sn-row"><button class="sn-btn sn-btn--primary">Save test</button><button class="sn-btn sn-btn--secondary">Run now</button><button class="sn-btn sn-btn--ghost">Cancel</button><button class="sn-btn sn-btn--danger">Delete test</button><button class="sn-btn sn-btn--primary" disabled>Saving…</button></div>
<div class="sn-row"><button class="sn-btn sn-btn--secondary sn-btn--sm">Add note</button><button class="sn-btn sn-btn--ghost sn-btn--sm">Hide</button></div></div>
```

## Callout

An inline message about the state of the page: a missing server setting, a failed request, a draft.

- **Degraded** tint for something the operator should fix (optional config missing); **outage** tint for a failed request; neutral for information.
- First words in bold mono name the condition; the sentence after says what to do.
- Sits at the top of the content it concerns, full width. Not dismissible: it leaves when the condition does.
- Every page that fetches data shows the outage callout on failure. Today a failed fetch renders as an empty list.

```html
<body class="sn-preview sn">
<div class="sn-stack"><div class="sn-callout sn-callout--degraded"><span class="sn-mark sn-mark--degraded"></span><div><b>Secrets are disabled.</b> Set <code>SECRETS_ENCRYPTION_KEY</code> on the server to store secrets. Tests that read <code>ctx.secrets</code> will fail until then.</div></div>
<div class="sn-callout sn-callout--outage"><span class="sn-mark sn-mark--outage"></span><div><b>Could not reach the API.</b> The dashboard is showing nothing because the request failed, not because there are no tests. Retry in a moment.</div></div>
<div class="sn-callout"><span class="sn-mark sn-mark--unknown"></span><div><b>Draft.</b> This report is visible only when signed in.</div></div></div>
```

## ChannelRouting

One notification channel assigned to a test or tag, with the events it receives.

- **Row:** channel name, its type as a neutral Tag ("slack bot", "discord webhook", "email", "webhook"), then three toggles.
- **Toggles:** Outage, Degraded, Recovered, each with its shape, spelled out. They replace the single letters F / W / R.
- Channel types no longer have their own colours (indigo, amber, emerald); the palette keeps colour for state only.
- A toggle saves immediately and reverts with a Callout if the save fails.
- On a test page the same row is read-only and says where the assignment comes from ("via tag tier:critical").

```html
<body class="sn-preview sn">
<div><div class="sn-channel"><span class="sn-channel__name">#ops-alerts</span><span class="sn-tag"><i>slack</i> bot</span><span class="sn-evts"><button class="sn-evt" aria-pressed="true"><span class="sn-mark sn-mark--outage"></span>Outage</button><button class="sn-evt" aria-pressed="true"><span class="sn-mark sn-mark--degraded"></span>Degraded</button><button class="sn-evt" aria-pressed="true"><span class="sn-mark sn-mark--recovered"></span>Recovered</button></span></div>
<div class="sn-channel"><span class="sn-channel__name">On-call email</span><span class="sn-tag">email</span><span class="sn-evts"><button class="sn-evt" aria-pressed="true"><span class="sn-mark sn-mark--outage"></span>Outage</button><button class="sn-evt" aria-pressed="false"><span class="sn-mark sn-mark--degraded"></span>Degraded</button><button class="sn-evt" aria-pressed="false"><span class="sn-mark sn-mark--recovered"></span>Recovered</button></span></div></div>
```

## CodeBlock

Read-only test code, error output and copyable commands.

- `code` style on `surface` with a `border` and `radius-md`. Long lines scroll inside the block.
- Comments in `fg-subtle`. No syntax colours beyond that: the palette has no spare hues.
- The editor (Monaco) uses the same ground, border and font so the read and edit views match; give it a theme built from `bg`, `surface`, `fg`, `fg-subtle`.
- Error messages from a run use this block with `outage` text for the first line.

```html
<body class="sn-preview sn">
<pre class="sn-code"><span class="c">// Fails when the newest radar frame is older than 15 minutes</span>
const res = await ctx.http.get(ctx.secrets.TILES_URL + '/radar/latest.json', { timeout: 8000 })
ctx.assert(res.status === 200, 'catalog reachable')
const age = (ctx.now() - Date.parse(res.json.time)) / 60000
ctx.assert(age &lt; 15, `frame is ${Math.round(age)} min old`)</pre>
```

## DefinitionGrid

Label-and-value pairs for a record's settings: a test's configuration, an incident's details.

- Term in `label`, value in `data`. Values carry their unit ("5 min", "3 runs"), never a bare number.
- Columns fill at 140px minimum; the grid wraps on its own.
- State values use words, not colour: "Active" / "Paused".
- Leave out fields that do nothing. "Uses browser" is removed until browser tests exist.

```html
<body class="sn-preview sn">
<dl class="sn-defs"><div><dt>Interval</dt><dd>5 min</dd></div><div><dt>Timeout</dt><dd>30 s</dd></div><div><dt>Retries</dt><dd>1</dd></div><div><dt>Failure threshold</dt><dd>3 runs</dd></div><div><dt>Alert cooldown</dt><dd>24 h</dd></div><div><dt>Schedule</dt><dd>Active</dd></div></dl>
```

## Dialog

A confirmation for an action that cannot be undone or that makes something public.

- Used for: delete a test, channel or secret; revoke a token; bulk actions over 20 tests; publish an incident or report.
- **Title** is the question ("Delete this test?"). **Body** in `body` says exactly what will happen, with counts. **Confirm** repeats the verb ("Delete test"); it is danger-styled for deletions and primary for publishing.
- `surface-raised` on `scrim`, `radius-md`, `shadow-popover`. Focus starts on Cancel and is trapped; `Esc` cancels.
- Built on the existing Radix alert dialog. The inline "delete "name"? yes / no" rows on the channel and secret lists move to this.

```html
<body class="sn-preview sn">
<div class="sn-scrim"><div class="sn-dialog" role="alertdialog" aria-labelledby="dt" aria-describedby="dd"><h2 id="dt">Publish this report?</h2><p id="dd">The summary, impact and 3 public updates will appear on the status page for anyone with the link. Internal notes stay private.</p><div class="sn-dialog__actions"><button class="sn-btn sn-btn--ghost">Cancel</button><button class="sn-btn sn-btn--primary">Publish report</button></div></div></div>
```

## EmptyState

What a list shows before it has anything in it.

- A mono title that names the absence, one or two sentences in `body` saying what the thing is, and the action that creates the first one.
- Where an agent can do it, say so and link to API tokens: Sentinel is built to be driven through MCP.
- Dashed `border-strong` outline, left-aligned. No illustration.
- A filter with no matches is not an empty state: show "No tests match "radar"." with a Clear link.

```html
<body class="sn-preview sn">
<div class="sn-empty"><h3>No tests yet</h3><p>A test is a JavaScript function that runs on a schedule. Write one here, or ask an agent to create it through the MCP server.</p><div class="sn-row"><a class="sn-btn sn-btn--primary" href="#">New test</a><a class="sn-btn sn-btn--ghost" href="#">Connect an agent</a></div></div>
```

## Field

A labelled input with its hint or error; also the checkbox and the switch.

- **Label** above the control in `label`, with the unit in the label ("Timeout (seconds)").
- **Control:** `bg` ground, `border-strong` outline, `radius-sm`, 36px tall. Today's inputs use `zinc-800` borders at about 1.3:1; this outline meets 3:1.
- **Hint** in `body-sm`, `fg-subtle`: one sentence on what the value does.
- **Error** replaces the hint, in `outage`, and says how to fix it. The control gets `aria-invalid` and an `outage` border.
- **Switch** for a setting that applies on save ("Scheduled"); **checkbox** for picking rows or options in a list.
- Forms are one column, `form-max` wide, fields `space-4` apart. Primary button at the bottom left, Cancel beside it.

```html
<body class="sn-preview sn">
<div class="sn-stack" style="max-width:420px"><div class="sn-field"><label class="sn-label" for="f1">Name</label><input class="sn-input" id="f1" value="Tiles · Radar Freshness"></div>
<div class="sn-field"><label class="sn-label" for="f2">Timeout (seconds)</label><input class="sn-input" id="f2" value="400" aria-invalid="true" aria-describedby="f2e"><span class="sn-field__error" id="f2e">Timeout must leave 20% of the 300 s interval free. Use 240 or less.</span></div>
<div class="sn-field"><label class="sn-label" for="f3">Failure threshold</label><input class="sn-input" id="f3" value="3"><span class="sn-field__hint">Consecutive failed runs before the test is in Outage and alerts are sent.</span></div>
<label class="sn-option"><input class="sn-switch" type="checkbox" checked> Scheduled</label></div>
```

## HistoryStrip

A row of equal cells, one per time bucket, coloured by the worst result in that bucket.

- **Cells:** `operational-solid` when every run passed, `degraded-solid` when results were mixed, `outage-solid` when every run failed, `strip-empty` for no runs.
- **Regular** (28px) on public cards and test pages, with the axis line and the uptime figure. **Compact** (14px) in table rows and grid cards.
- 30 cells for 30 days; 100 for 1 h, 24 h and 7 d; grid cards sample down to 30.
- Hover or focus on a cell shows its time range and run counts. On touch, tapping the strip opens the test page instead.
- Loading state: all cells `strip-empty`, pulsing. No spinner.

The consumer provides the buckets and the period.

```html
<body class="sn-preview sn">
<div class="sn-stack"><div><div class="sn-row" style="justify-content:space-between;margin-bottom:8px"><span>Tiles · Radar Freshness</span><span class="sn-num sn-muted">99.2% in 30 days</span></div><div class="sn-strip" role="img" aria-label="Status history"><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--degraded"></span><span class="sn-strip__cell sn-strip__cell--outage"></span><span class="sn-strip__cell sn-strip__cell--outage"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--degraded"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--none"></span></div><div class="sn-strip__axis"><span>30 days ago</span><span>today</span></div></div>
<div style="max-width:256px"><div class="sn-strip sn-strip--compact" role="img" aria-label="Status history"><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--degraded"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--outage"></span><span class="sn-strip__cell sn-strip__cell--degraded"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span></div></div></div>
```

## IncidentBanner

A published incident on the public status page: severity, state, title, latest public update and timing.

- Appears under the StatusBanner only after someone publishes the incident. Until then the public page shows the affected checks in their sections and nothing else.
- **Open incidents** take the tint of their worst state. **Resolved** ones are neutral and listed under "Incidents in the last 30 days".
- **Latest update** is the most recent published note, in `body`. If there is none, the line is omitted.
- **Meta:** start and duration, number of checks affected, last update time. Times in UTC unless the visitor switched to Local.
- The whole banner links to the public incident page.
- Signed in, the same row appears on `/incidents` with a visibility chip: Internal, Published.

```html
<body class="sn-preview sn">
<div class="sn-stack"><a class="sn-incident sn-incident--outage" href="#"><div class="sn-row"><span class="sn-status sn-status--outage sn-status--chip"><span class="sn-mark"></span>Outage</span><span class="sn-vis sn-vis--published">Identified</span></div><h2 class="sn-incident__title">Radar map frozen at 18:20 UTC</h2><p class="sn-incident__update">A radar processing run stalled and is blocking the runs behind it. We are clearing it; missed frames will be backfilled.</p><div class="sn-incident__meta"><span>Started 18:43 UTC · 2 h 27 min</span><span>2 checks affected</span><span>Updated 21:04 UTC</span></div></a>
<a class="sn-incident" href="#"><div class="sn-row"><span class="sn-status sn-status--recovered sn-status--chip"><span class="sn-mark"></span>Recovered</span><span class="sn-vis">Resolved</span></div><h2 class="sn-incident__title">Satellite tiles stale</h2><div class="sn-incident__meta"><span>8 Nov · lasted 25 h 27 min</span><span>1 check affected</span><span>Report published</span></div></a></div>
```

## IncidentReport

The written account of an incident: Summary, Impact, Root cause, Resolution, Follow-ups.

- Set in the Prose styles (`prose-heading`, `body`) at `prose-max` width. This is the one place in Sentinel that reads as a document.
- **Two versions** of each section, Internal and Public, switched with a SegmentedControl. The public version leaves out hostnames, pod names and people.
- **States:** no report, Draft report, Report published. Publishing opens a Dialog that previews exactly the public text.
- The report keeps the incident's duration, affected tests and failed-run counts as stored numbers, so it outlives run retention.
- Markdown in, rendered as paragraphs, lists, links and code. No images in the first version.

```html
<body class="sn-preview sn">
<article class="sn-prose"><div class="sn-row" style="margin-bottom:8px"><span class="sn-vis">Draft report</span><div class="sn-seg" role="group" aria-label="Version"><button aria-pressed="false">Internal</button><button aria-pressed="true">Public</button></div></div>
<h3 style="margin-top:8px">Summary</h3><p>On 9 November the radar layer stopped updating for 2 hours 27 minutes. It showed the 18:20 UTC frame until 21:10 UTC.</p>
<h3>Impact</h3><p>The radar map was stale. Forecasts, warnings and all other layers were not affected. No data was lost; every missed frame was backfilled.</p>
<h3>Root cause</h3><p>A brief interruption in the cluster's control plane left one processing run stuck, and that run blocked the ones queued behind it.</p></article>
```

## IncidentState

Where an incident is in its life, and who can see it.

- **States, in order:** Investigating, Identified, Monitoring, Resolved. Sentinel opens an incident in Investigating when a test reaches Outage, and moves it to Resolved when every linked test has recovered. People and agents set the middle two.
- The current state uses `primary`; earlier ones are filled squares, later ones hollow.
- Changing state writes a system entry to the timeline.
- **Visibility chips:** Internal (default), Published; Draft report, Report published. Agents can write notes and draft reports through MCP; only a signed-in person can publish.

```html
<body class="sn-preview sn">
<div class="sn-stack"><ol class="sn-steps" aria-label="Incident state"><li data-done>Investigating</li><li aria-current="step">Identified</li><li>Monitoring</li><li>Resolved</li></ol>
<div class="sn-row"><span class="sn-vis">Internal</span><span class="sn-vis sn-vis--published">Published</span><span class="sn-vis">Draft report</span><span class="sn-vis sn-vis--published">Report published</span></div></div>
```

## IncidentTimeline

The ordered record of an incident: entries Sentinel writes itself and notes people or agents add.

- **System entries** (state changes of linked tests, incident state changes, publishing) are one mono line in `fg-muted`.
- **Notes** are prose in `body`, followed by the author ("victor", "agent · mcp", a token name) and a visibility chip.
- Oldest first. Time in the left column in tabular figures; on a phone it moves above the entry.
- The public incident page shows system entries about state and the Published notes only.
- The note composer sits under the list: a textarea, a "Show on status page" checkbox (off by default) and "Add note".

```html
<body class="sn-preview sn">
<ol class="sn-timeline"><li data-kind="system"><time datetime="2026-11-09T18:43Z">18:43 UTC</time><div><p>Tiles · Radar Freshness entered Outage</p></div></li>
<li data-kind="system"><time>20:24 UTC</time><div><p>Tiles · Radar Staleness entered Degraded</p></div></li>
<li><time>21:02 UTC</time><div><p>The workflow controller logs only go back to 20:16, so the reason the run stayed stuck is not confirmed.</p><div class="sn-timeline__by"><span>agent · mcp</span><span class="sn-vis">Internal</span></div></div></li>
<li><time>21:04 UTC</time><div><p>The stalled run was removed. The next run is backfilling the 32 missed frames.</p><div class="sn-timeline__by"><span>victor</span><span class="sn-vis sn-vis--published">Published</span></div></div></li>
<li data-kind="system"><time>21:10 UTC</time><div><p>Both tests recovered · incident resolved after 2 h 27 min</p></div></li></ol>
```

## LatencyChart

Response time of one test over the selected period, with problem windows marked under the line.

- **Line** in `fg-muted`, 1.5px, with an `overlay` area and an emphasised endpoint in `fg`. The line is neutral: the state colours belong to the event bars, not to latency.
- **Events:** a 5px bar under the plot for each Degraded or Outage window, in that state's solid colour, labelled with its start.
- Three horizontal grid lines in `border`; ticks in `label` size, `fg-subtle`; the y axis starts at 0.
- Recharts stays; give it these tokens instead of the hex values hard-coded in the two chart components today.

```html
<body class="sn-preview sn">
<svg class="sn-chart" viewBox="0 0 720 170" role="img" aria-label="Response time over the last 24 hours, between 180 and 1,240 ms"><line class="grid" x1="48" x2="712" y1="20" y2="20"/><line class="grid" x1="48" x2="712" y1="75" y2="75"/><line class="grid" x1="48" x2="712" y1="130" y2="130"/><text class="tick" x="40" y="24" text-anchor="end">1,200</text><text class="tick" x="40" y="79" text-anchor="end">600</text><text class="tick" x="40" y="134" text-anchor="end">0 ms</text><path class="area" d="M48 112 110 110 172 113 234 109 296 111 358 108 420 96 482 60 544 22 606 70 668 104 712 106V130H48Z"/><path class="line" d="M48 112 110 110 172 113 234 109 296 111 358 108 420 96 482 60 544 22 606 70 668 104 712 106"/><rect class="evt-degraded" x="476" y="136" width="62" height="5"/><rect class="evt-outage" x="538" y="136" width="40" height="5"/><circle class="end" cx="712" cy="106" r="3.5"/><text class="tick" x="48" y="160">24 h ago</text><text class="tick" x="712" y="160" text-anchor="end">now</text><text class="tick" x="476" y="154">Degraded 14:10</text></svg>
```

## Logo

The Sentinel mark (the Beacon) and its lockup with the wordmark.

A mast and a signal standing on Territorial's tile: one 3.5-unit round stroke on a 64-unit grid, the outline in `fg`, the signal in `accent`. It replaces the traced watchtower.

- **Lockup:** the mark at 28px beside the word `sentinel` in the `wordmark` style, 10px apart. The word is always lowercase.
- **Mark alone:** favicon, the sign-in page, the public footer, Slack and Discord bot avatars.
- **Minimum size:** 16px. Below 24px drop the outer signal arcs.
- **Colour:** only `fg` + `accent`. Never recolour the signal to a state colour.
- Use `assets/Logos/sentinel-beacon-on-dark.svg` and `-on-light.svg` for files; inline the SVG with the `sn-logo` classes when it must follow the theme.
- Don't place the Territorial symbol beside it. Territorial appears as the text `territorial.dev` in the public footer.

```html
<body class="sn-preview sn">
<div class="sn-row" style="gap:48px;align-items:flex-end"><svg class="sn-logo" viewBox="0 0 64 64" height="96" width="96" aria-hidden="true"><path class="ink" d="M6 46 32 34 58 46 32 58Z"/><path class="ink" d="M32 46V22"/><circle class="dot" cx="32" cy="18" r="3.2"/><path class="sig" d="M38.36 11.64A9 9 0 0 1 38.36 24.36M25.64 11.64A9 9 0 0 0 25.64 24.36"/><path class="sig2" d="M42.61 7.39A15 15 0 0 1 42.61 28.61M21.39 7.39A15 15 0 0 0 21.39 28.61"/></svg><div class="sn-brand" style="font-size:32px;line-height:36px;gap:14px"><svg class="sn-logo" viewBox="0 0 64 64" height="44" width="44" aria-hidden="true"><path class="ink" d="M6 46 32 34 58 46 32 58Z"/><path class="ink" d="M32 46V22"/><circle class="dot" cx="32" cy="18" r="3.2"/><path class="sig" d="M38.36 11.64A9 9 0 0 1 38.36 24.36M25.64 11.64A9 9 0 0 0 25.64 24.36"/><path class="sig2" d="M42.61 7.39A15 15 0 0 1 42.61 28.61M21.39 7.39A15 15 0 0 0 21.39 28.61"/></svg>sentinel</div><div class="sn-brand"><svg class="sn-logo" viewBox="0 0 64 64" height="28" width="28" aria-hidden="true"><path class="ink" d="M6 46 32 34 58 46 32 58Z"/><path class="ink" d="M32 46V22"/><circle class="dot" cx="32" cy="18" r="3.2"/><path class="sig" d="M38.36 11.64A9 9 0 0 1 38.36 24.36M25.64 11.64A9 9 0 0 0 25.64 24.36"/><path class="sig2" d="M42.61 7.39A15 15 0 0 1 42.61 28.61M21.39 7.39A15 15 0 0 0 21.39 28.61"/></svg>sentinel</div><svg class="sn-logo" viewBox="0 0 64 64" height="20" width="20" aria-hidden="true"><path class="ink" d="M6 46 32 34 58 46 32 58Z"/><path class="ink" d="M32 46V22"/><circle class="dot" cx="32" cy="18" r="3.2"/><path class="sig" d="M38.36 11.64A9 9 0 0 1 38.36 24.36M25.64 11.64A9 9 0 0 0 25.64 24.36"/><path class="sig2" d="M42.61 7.39A15 15 0 0 1 42.61 28.61M21.39 7.39A15 15 0 0 0 21.39 28.61"/></svg></div>
```

## PageHeader

Back link, title, state line and actions at the top of a detail page.

- **Back link:** names where it goes ("← Tests", "← Incidents"), never "← back".
- **Title:** `page-title`, one per page. Today the h1 is 14px on the editor, 18px on the test page and 24px on the public test page; all become this.
- **Meta line:** the status chip first, then the "since" text, then tags.
- **Actions:** at most one primary. Order: quiet actions, destructive, primary.
- The header ends with a `border` rule; sections start `space-8` below it.

```html
<body class="sn-preview sn">
<div><a class="sn-back" href="#">← Tests</a><div class="sn-pagehead"><div style="min-width:0"><h1>Tiles · Radar Freshness</h1><div class="sn-pagehead__meta"><span class="sn-status sn-status--outage sn-status--chip"><span class="sn-mark"></span>Outage</span><span>failing for 2 h 27 min</span><a class="sn-tag" href="#"><i>layer:</i>pipelines</a><a class="sn-tag" href="#"><i>tier:</i>critical</a></div></div>
<div class="sn-row"><button class="sn-btn sn-btn--ghost">Edit</button><button class="sn-btn sn-btn--danger">Delete</button><button class="sn-btn sn-btn--primary">Run now</button></div></div></div>
```

## PublicHeader

Header and footer of the public status pages (`/status`, `/status/[tag]`, `/status/tests/[id]`, `/status/incidents/[id]`).

Public pages never show the signed-in nav. They are the product's face: readable by someone who has never seen Sentinel.

- **Title:** the instance or tag title in `page-title`. A fork sets it; there is no branding setting in the UI.
- **Tags:** filter pills under the title; the selected one uses `primary`.
- **Theme:** Light / Dark / System, default System. Stored per browser.
- **Footer:** the timezone and refresh note on the left; "Powered by sentinel, open source from territorial.dev" on the right. Forks may change the right side.
- No sign-in link, no test code, no error messages, no internal notes on any public page.

```html
<body class="sn-preview sn">
<div class="sn-stack"><header class="sn-pubbar"><div><h1 class="sn-pubbar__title">Maps platform status</h1><div class="sn-tags" style="margin-top:8px"><a class="sn-tag" href="#" aria-current="true">all</a><a class="sn-tag" href="#"><i>ui:</i>maps</a><a class="sn-tag" href="#"><i>layer:</i>pipelines</a><a class="sn-tag" href="#"><i>layer:</i>storage</a></div></div>
<div class="sn-row"><div class="sn-seg" role="group" aria-label="Theme"><button aria-pressed="false">Light</button><button aria-pressed="true">Dark</button><button aria-pressed="false">System</button></div></div></header>
<footer class="sn-pubfoot"><span>Times in UTC · refreshes every 60 s</span><span>Powered by <a href="#">sentinel</a>, open source from territorial.dev</span></footer></div>
```

## SearchAndBulk

The search box above the dashboard and the toolbar that appears when rows are selected.

New. An instance with 148 tests has no way to find one except scrolling or a tag filter.

- **Search** filters as you type on name and tags, across every section; sections with no match hide. `/` focuses it, `Esc` clears it. The count beside it reads "4 of 148 tests".
- The query goes in the URL (`?q=`) next to `?tag=`.
- **Bulk bar** appears, fixed to the bottom of the viewport, once a row is selected. It shows the count and: Run now, Pause, Resume, Add tag…, Delete…, Clear.
- Delete and anything touching more than 20 tests is confirmed in a Dialog that names the count.
- Each bulk action maps to one API call that takes a list of ids, and to the same MCP tool, so agents and the UI share it.

```html
<body class="sn-preview sn">
<div class="sn-stack"><div class="sn-row"><label class="sn-search"><input class="sn-input" id="q" type="search" value="radar" aria-label="Search tests"><span class="sn-kbd">/</span></label><span class="sn-muted">4 of 148 tests</span></div>
<div class="sn-bulk" role="toolbar" aria-label="Bulk actions"><span class="sn-bulk__count">3 selected</span><button class="sn-btn sn-btn--secondary sn-btn--sm">Run now</button><button class="sn-btn sn-btn--secondary sn-btn--sm">Pause</button><button class="sn-btn sn-btn--secondary sn-btn--sm">Resume</button><button class="sn-btn sn-btn--secondary sn-btn--sm">Add tag…</button><button class="sn-btn sn-btn--danger sn-btn--sm">Delete…</button><button class="sn-btn sn-btn--ghost sn-btn--sm">Clear</button></div></div>
```

## SectionHeader

The summary chips and section headings that stack a page by state.

Sections, in order: **Outage**, **Degraded**, **Recovered in the last 24 hours**, **Operational**, **Paused**. These rename today's "Critical failures", "Warnings", "Recoveries…", "No problems reported…" and "Disabled".

- **Chips:** one per visible section, each a link to it, with the state's shape and a count.
- **Heading:** shape, title in `section-title`, count, and a one-line description at the right in `body-sm`.
- Outage, Degraded and Recovered always show, with an empty line when they hold nothing ("Nothing is failing."). Operational and Paused are collapsed behind "Show all N" and hidden when empty.
- The same component serves the dashboard table, the status grid and the incident list (Open, Resolved in the last 30 days).

```html
<body class="sn-preview sn">
<div class="sn-stack"><nav class="sn-chips" aria-label="Sections"><a class="sn-chip" href="#"><span class="sn-mark sn-mark--outage"></span>Outage <b>1</b></a><a class="sn-chip" href="#"><span class="sn-mark sn-mark--degraded"></span>Degraded <b>2</b></a><a class="sn-chip" href="#"><span class="sn-mark sn-mark--recovered"></span>Recovered in 24 h <b>3</b></a><a class="sn-chip" href="#"><span class="sn-mark sn-mark--operational"></span>Operational <b>36</b></a><a class="sn-chip" href="#"><span class="sn-mark sn-mark--paused"></span>Paused <b>4</b></a></nav>
<div class="sn-section sn-section--outage"><div class="sn-section__head"><span class="sn-mark sn-mark--outage"></span><h2 class="sn-section__title">Outage</h2><span class="sn-section__count">1</span><span class="sn-section__desc">Failing for at least the failure threshold. Newest first.</span></div></div>
<div class="sn-section sn-section--recovered"><div class="sn-section__head"><span class="sn-mark sn-mark--recovered"></span><h2 class="sn-section__title">Recovered in the last 24 hours</h2><span class="sn-section__count">3</span><span class="sn-section__desc">Operational now. Most recent first.</span></div></div></div>
```

## SegmentedControl

A small set of mutually exclusive choices: period, grid or list, UTC or local time, internal or public version.

- Two to five options; the selected one uses `primary` / `on-primary`, the rest `surface-raised`.
- Options are words or short values ("24 h", "Grid"), not bare icons.
- The choice is written to the URL so a shared link opens the same view.
- Each button carries `aria-pressed`; the group has a label.

```html
<body class="sn-preview sn">
<div class="sn-row"><div class="sn-seg" role="group" aria-label="Period"><button aria-pressed="false">1 h</button><button aria-pressed="true">24 h</button><button aria-pressed="false">7 d</button><button aria-pressed="false">30 d</button></div><div class="sn-seg" role="group" aria-label="View"><button aria-pressed="true">Grid</button><button aria-pressed="false">List</button></div><div class="sn-seg" role="group" aria-label="Times"><button aria-pressed="true">UTC</button><button aria-pressed="false">Local</button></div></div>
```

## StatusBanner

The one-line answer at the top of a public status page: is everything working?

New. Today a visitor has to read the section counts to find out.

- One banner per page, directly under the header, above the summary chips.
- **Wording:** "All systems operational"; "N checks degraded"; "Outage on N checks" (append ", M degraded" when both). The worst state sets the colour.
- **Meta:** the number of checks on this page and how long ago the data was fetched.
- Tests are called "checks" on public pages and "tests" when signed in.
- The banner states what Sentinel measured. Published incidents appear below it as IncidentBanner; an unpublished incident changes nothing here beyond the counts.

```html
<body class="sn-preview sn">
<div class="sn-stack"><div class="sn-banner sn-banner--operational"><span class="sn-mark sn-mark--operational"></span><h2 class="sn-banner__title">All systems operational</h2><span class="sn-banner__meta">42 checks · updated 40 s ago</span></div>
<div class="sn-banner sn-banner--degraded"><span class="sn-mark sn-mark--degraded"></span><h2 class="sn-banner__title">2 checks degraded</h2><span class="sn-banner__meta">42 checks · updated 12 s ago</span></div>
<div class="sn-banner sn-banner--outage"><span class="sn-mark sn-mark--outage"></span><h2 class="sn-banner__title">Outage on 1 check, 2 degraded</h2><span class="sn-banner__meta">42 checks · updated 5 s ago</span></div></div>
```

## StatusCard

One check on the public status grid: name, uptime for the period, state with its since line, and a compact history strip.

- The whole card is a link to the public test page.
- **Name** has the first line to itself, so most names fit at 220px; longer ones end in an ellipsis with the full name in `title`.
- **Metric:** uptime for the selected period with one decimal, period label beside it.
- **State line:** the StatusIndicator, then the since text in `fg-subtle` ("failing for 2 h 27 min", "no problems in 7 d"). Always present, so cards keep one height.
- Flat: `surface`, `border`, `radius-md`. Hover changes the border to `border-strong`. No hover popover; the detail lives on the test page.
- Grid columns are `minmax(220px, 1fr)`; one column on a phone.

```html
<body class="sn-preview sn">
<div class="sn-cards"><a class="sn-card" href="#"><span class="sn-card__name">Tiles · Radar Freshness</span><div class="sn-card__metric sn-num">96.4%<small>7 d</small></div><div class="sn-card__state"><span class="sn-status sn-status--outage"><span class="sn-mark"></span>Outage</span><span>failing for 2 h 27 min</span></div><div class="sn-strip sn-strip--compact" role="img" aria-label="Status history"><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--degraded"></span><span class="sn-strip__cell sn-strip__cell--outage"></span><span class="sn-strip__cell sn-strip__cell--outage"></span><span class="sn-strip__cell sn-strip__cell--outage"></span></div></a><a class="sn-card" href="#"><span class="sn-card__name">API · Forecast Catalog</span><div class="sn-card__metric sn-num">99.7%<small>7 d</small></div><div class="sn-card__state"><span class="sn-status sn-status--degraded"><span class="sn-mark"></span>Degraded</span><span>1 of 3 failures</span></div><div class="sn-strip sn-strip--compact" role="img" aria-label="Status history"><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--degraded"></span></div></a><a class="sn-card" href="#"><span class="sn-card__name">Kubernetes · api/gateway Ready</span><div class="sn-card__metric sn-num">100%<small>7 d</small></div><div class="sn-card__state"><span class="sn-status sn-status--operational"><span class="sn-mark"></span>Operational</span><span>no problems in 7 d</span></div><div class="sn-strip sn-strip--compact" role="img" aria-label="Status history"><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span></div></a></div>
```

## StatusIndicator

The state of a test as a shape and a word: Operational, Degraded, Outage, Recovered, No data, Paused.

This is the single vocabulary. It replaces `pass/warn/fail`, `up/degraded/down`, `critical/warning` and `UP/DOWN` wherever a person reads a test's state: dashboard, status page, notifications, MCP text and docs.

| State | Shape | Means |
| --- | --- | --- |
| Operational | disc | Last run passed and nothing went wrong in 24 h |
| Degraded | triangle | A warning now, or failing but under the failure threshold |
| Outage | square | Failing for at least the failure threshold |
| Recovered | ring | Operational now, with a problem in the last 24 h |
| No data | grey ring | No runs yet |
| Paused | bar | Not scheduled (was "disabled") |

- Never show the colour without the shape and the word; the shapes are what a colour-blind reader uses.
- **Plain** in tables and lists; **chip** in page headers and incident rows.
- **Run results** are a separate, lower level: Passed, Warned, Failed, Timed out. They appear only in a test's run history, with the same three shapes.
- Notification events use the same words: Outage, Degraded, Recovered.

```html
<body class="sn-preview sn">
<div class="sn-stack"><div class="sn-row"><span class="sn-status sn-status--operational"><span class="sn-mark"></span>Operational</span><span class="sn-status sn-status--degraded"><span class="sn-mark"></span>Degraded</span><span class="sn-status sn-status--outage"><span class="sn-mark"></span>Outage</span><span class="sn-status sn-status--recovered"><span class="sn-mark"></span>Recovered</span><span class="sn-status sn-status--unknown"><span class="sn-mark"></span>No data</span><span class="sn-status sn-status--paused"><span class="sn-mark"></span>Paused</span></div>
<div class="sn-row"><span class="sn-status sn-status--operational sn-status--chip"><span class="sn-mark"></span>Operational</span><span class="sn-status sn-status--degraded sn-status--chip"><span class="sn-mark"></span>Degraded</span><span class="sn-status sn-status--outage sn-status--chip"><span class="sn-mark"></span>Outage</span><span class="sn-status sn-status--recovered sn-status--chip"><span class="sn-mark"></span>Recovered</span><span class="sn-status sn-status--unknown sn-status--chip"><span class="sn-mark"></span>No data</span><span class="sn-status sn-status--paused sn-status--chip"><span class="sn-mark"></span>Paused</span></div>
<div class="sn-row sn-subtle" style="font-size:12px">Run results, in run history only: <span class="sn-status sn-status--operational"><span class="sn-mark"></span>Passed</span><span class="sn-status sn-status--degraded"><span class="sn-mark"></span>Warned</span><span class="sn-status sn-status--outage"><span class="sn-mark"></span>Failed</span><span class="sn-status sn-status--outage"><span class="sn-mark"></span>Timed out</span></div></div>
```

## Tag

A free-form label on a test; also the filter pill at the top of the dashboard and status page.

- Tags written `key:value` show the key in `fg-subtle` and the value in `fg`, so `layer:` and `tier:` families scan as columns.
- A tag is a link: it filters the current page (dashboard) or opens `/status/[tag]` (public).
- The selected filter uses `primary` / `on-primary`. It no longer uses emerald, which is reserved for Operational.
- When tags overflow a row, the rest collapse into `+N`, which opens the full list on hover and focus.

```html
<body class="sn-preview sn">
<div class="sn-stack"><div class="sn-tags"><a class="sn-tag" href="#" aria-current="true">all</a><a class="sn-tag" href="#"><i>layer:</i>pipelines</a><a class="sn-tag" href="#"><i>layer:</i>storage</a><a class="sn-tag" href="#"><i>tier:</i>critical</a><a class="sn-tag" href="#"><i>ui:</i>maps</a><a class="sn-tag" href="#">nightly</a><span class="sn-tag">+4</span></div></div>
```

## TestTable

The dashboard's table of tests: one row per test, inside a section.

- **Columns:** select, Name (with tags), Status, Since, Last run, Avg response, History. Numbers are right-aligned with tabular figures.
- **Name** is the link to the test. Tags follow it and filter the dashboard when clicked.
- **Since** is two lines: the state's duration in the state colour, then a `fg-subtle` detail.
- **Select** column feeds the bulk bar (see SearchAndBulk). It appears on hover or focus and stays visible once any row is selected.
- Column headers sort within the section; the section's own order is the default.
- The table scrolls sideways inside its own wrapper below 980px; the page never does.
- Rows are 44px tall. Row hover uses `overlay`.

```html
<body class="sn-preview sn">
<div class="sn-table-wrap"><table class="sn-table" style="min-width:980px"><thead><tr><th style="width:28px"></th><th>Name</th><th>Status</th><th>Since</th><th>Last run</th><th class="sn-num">Avg response</th><th>History · 24 h</th></tr></thead><tbody><tr><td><input class="sn-check" type="checkbox" aria-label="Select Tiles · Radar Freshness" checked></td><td><a class="sn-table__name" href="#">Tiles · Radar Freshness</a> <span class="sn-tags" style="display:inline-flex;margin-left:6px"><a class="sn-tag" href="#"><i>layer:</i>pipelines</a><a class="sn-tag" href="#"><i>tier:</i>critical</a></span></td><td><span class="sn-status sn-status--outage"><span class="sn-mark"></span>Outage</span></td><td><span style="color:var(--outage)">failing for 2 h 27 min</span><span class="sn-table__sub">since 18:43 UTC</span></td><td>3 min ago</td><td class="sn-num">—</td><td style="width:220px"><div class="sn-strip sn-strip--compact" role="img" aria-label="Status history"><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--degraded"></span><span class="sn-strip__cell sn-strip__cell--outage"></span><span class="sn-strip__cell sn-strip__cell--outage"></span><span class="sn-strip__cell sn-strip__cell--outage"></span></div></td></tr><tr><td><input class="sn-check" type="checkbox" aria-label="Select API · Forecast Catalog"></td><td><a class="sn-table__name" href="#">API · Forecast Catalog</a> <span class="sn-tags" style="display:inline-flex;margin-left:6px"><a class="sn-tag" href="#"><i>layer:</i>services</a><a class="sn-tag" href="#"><i>tier:</i>warning</a></span></td><td><span class="sn-status sn-status--degraded"><span class="sn-mark"></span>Degraded</span></td><td><span style="color:var(--degraded)">1 of 3 failures</span><span class="sn-table__sub">threshold 3</span></td><td>40 s ago</td><td class="sn-num">1,240 ms</td><td style="width:220px"><div class="sn-strip sn-strip--compact" role="img" aria-label="Status history"><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--degraded"></span></div></td></tr><tr><td><input class="sn-check" type="checkbox" aria-label="Select Storage · Model Run Presence"></td><td><a class="sn-table__name" href="#">Storage · Model Run Presence</a> <span class="sn-tags" style="display:inline-flex;margin-left:6px"><a class="sn-tag" href="#"><i>layer:</i>storage</a></span></td><td><span class="sn-status sn-status--recovered"><span class="sn-mark"></span>Recovered</span></td><td><span style="color:var(--operational)">recovered 5 h ago</span><span class="sn-table__sub">was down 25 min</span></td><td>2 min ago</td><td class="sn-num">310 ms</td><td style="width:220px"><div class="sn-strip sn-strip--compact" role="img" aria-label="Status history"><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--outage"></span><span class="sn-strip__cell sn-strip__cell--degraded"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span><span class="sn-strip__cell sn-strip__cell--operational"></span></div></td></tr></tbody></table></div>
```

