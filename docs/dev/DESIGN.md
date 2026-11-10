# Design system

The rules, tokens and components every Sentinel screen is built from. Read this before building or changing a page, in Sentinel or in a fork.

- **Tokens** (the values a fork edits): `apps/web/app/styles/tokens.css`
- **Component CSS** (the `sn-*` classes): `apps/web/app/styles/components.css`
- **React components**: `apps/web/app/_components/ui/`, one file per component below, exported from `index.ts`
- **Logo files**: `apps/web/assets/Logos/`
- **Live design system** (tokens, every component rendered in both themes, a prototype of every page): https://claude.ai/artifact/DAh6vKTaFrwYZWp6JcCm2m

Sentinel is an open-source synthetic testing and uptime monitor from territorial.dev. It runs JavaScript tests on a schedule and publishes what it finds on a public status page. Design for that public page first: a visitor who has never seen Sentinel should know in one glance whether things work. The signed-in side is for one operator and their agents; keep it dense, consistent and quiet.

## Principles

1. **The public page is the product.** Decide how a thing looks on the status page before deciding how it looks signed in. Both sides use the same components.
2. **Colour means state.** Emerald, amber and red say Operational, Degraded and Outage. Nothing else is coloured: not buttons, not links, not channel types.
3. **Every state is a shape and a word.** A disc, a triangle, a square. Colour alone never carries a state.
4. **One name per thing.** Use the vocabulary below in the UI, in notifications, in MCP tool text and in the docs.
5. **Change tokens, not components.** A fork restyles Sentinel by editing token values. There is no theming or branding setting in the UI.

## Vocabulary

| Say | Not | Where |
| --- | --- | --- |
| Operational, Degraded, Outage | up/down, pass/fail, critical/warning, healthy | A test's state, everywhere a person reads it |
| Recovered | recovery, back up | Operational now, problem in the last 24 h |
| No data, Paused | unknown, disabled | No runs yet; not scheduled |
| Passed, Warned, Failed, Timed out | success, warn, fail | A single run, in run history only |
| test (signed in), check (public) | probe, monitor | The unit Sentinel runs |
| incident | failure streak, problem window, thread | A stored outage with a timeline and a report |
| Investigating, Identified, Monitoring, Resolved | open/closed | Incident states |
| Internal, Published | private/public, draft (for notes) | Who can see an incident, note or report |
| channel | notification target, delivery target | Where alerts go |
| status page | public dashboard | The public pages at `/` and under `/status` |
| API tokens | mcp, tokens | The page that issues tokens for agents |

Degraded covers two cases: the test raised a warning, or it is failing but still under its failure threshold. Say which in the "since" line ("1 of 3 failures"), not with a different word.

Wire values (`up`, `degraded`, `down`, `success`, `warn`, `fail`, `timeout`, the section keys) never change. They turn into these words in one place: the label maps in `packages/shared/src/state.ts`, with the web's additions in `apps/web/lib/states.ts`. See [Status and incidents](../guide/status-and-incidents.md).

## Writing

- Sentence case for every label, heading and button. The only lowercase proper noun is the wordmark `sentinel`. Uppercase is a type style (`label`, `section-title`), never typed.
- Buttons are a verb and an object: "Save test", "Publish report", "Revoke token".
- State facts with their numbers and units: "failing for 2 h 27 min", "1 of 3 failures", "99.2% in 30 days". Durations use `h`, `min`, `s`, `d` with a space.
- Times are UTC and say so ("18:43 UTC"). Public pages offer a UTC / Local switch. Relative times ("3 min ago") only for things under a day old.
- Errors say what failed and what to do: "Timeout must leave 20% of the 300 s interval free. Use 240 or less."
- Public text never includes hostnames, pod names, error messages, test code or people's names.
- No emoji, in the UI or in notification messages. No exclamation marks.

## Colour

- Ground is `bg`; cards and code sit on `surface`; popovers, dialogs, tags and inputs' neighbours on `surface-raised`. Hover is the `overlay` wash.
- Text is `fg`; secondary text `fg-muted`; labels, hints and timestamps `fg-subtle`. Do not use anything lighter than `fg-subtle` for text.
- `border` divides; it is decorative. Controls are outlined in `border-strong`.
- The primary button and the selected segment or filter are `primary` with `on-primary` text: white on black in dark, black on white in light.
- `accent` (Territorial's emerald) appears in three places only: the logo's signal, the focus ring, and the underline of the current nav item.
- State uses three tokens each: the word in `operational` / `degraded` / `outage`, the mark in `…-solid`, a chip or banner ground in `…-tint`.
- Dark is the first theme and the default signed in. Public pages follow the visitor's system setting and offer Light / Dark / System.

## Type

- Interface text is Inconsolata (`--font-mono`): names, numbers, labels, buttons, tables, code. It is Territorial's face and it keeps figures aligned.
- Prose is Inter (`--font-sans`): incident reports and updates, hints, descriptions, dialog and empty-state copy. If it is a sentence someone reads, it is Inter.
- Both load through `next/font/google`, self-hosted at build; no runtime font request.
- One `page-title` per page. Sections are headed in `section-title`. Fields and columns are labelled in `label`.
- Numbers that line up use tabular figures. Nothing is smaller than 11px.

## Layout

- Pages are centred at `page-max`, with a `space-6` gutter (`space-4` on a phone) and `space-12` above and below. Forms and settings are `form-max`; report text is `prose-max`.
- Sections are `space-8` apart and stacked by state: Outage, Degraded, Recovered, Operational, Paused.
- Corners are `radius-sm` on controls and `radius-md` on cards, code, dialogs and banners. The only round things are the Operational disc and the switch.
- Surfaces are flat. `shadow-popover` is for popovers, dialogs and the bulk bar.
- Every page works at 400px wide. Tables scroll inside their own wrapper; cards go to one column. The page never scrolls sideways.
- Motion is limited to colour transitions of 150ms and the loading pulse on history cells. Respect `prefers-reduced-motion`.

## Iconography

Sentinel has no icon set. It uses:

- the three state shapes (disc, triangle, square) plus ring and bar, drawn in CSS by `sn-mark`;
- typographic arrows: `←` on back links, `↗` on links that leave the app, `→` for "view details";
- the `sn-kbd` key cap for shortcuts.

Use a word where an icon would go. If a control truly needs a pictogram, draw it inline at 14px with a 1.5px stroke in `currentColor`.

## Logo

The mark is the Beacon: a mast and signal on Territorial's tile, outline in `fg`, signal in `accent`. The lockup is the mark at 28px and the word `sentinel` in the `wordmark` style. Files are in `apps/web/assets/Logos/` (`sentinel-beacon-on-dark.svg`, `sentinel-beacon-on-light.svg`). Territorial is credited in text in the public footer, not with its symbol.

## Routes

- `/` is the public status page. A visitor never lands on a sign-in form. `/status/...` keeps working for tag pages, checks and incidents.
- Everything signed in lives under `/admin`: `/admin` is the sign-in page (and sends a signed-in operator to `/admin/tests`), then `/admin/tests`, `/admin/incidents`, `/admin/notifications`, `/admin/secrets`, `/admin/tokens`.
- Public pages carry no link to `/admin`. Old signed-in paths redirect to their `/admin` equivalents.

## Forks and agents

- A fork that builds on Sentinel (a station map, its own monitor pages) changes token values and adds its own pages and components. It does not edit the shared components, so it can keep pulling from upstream. See [Forking](../FORKING.md).
- Sentinel is developed mostly by agents. When building a screen: read this page, then the component's guidelines below, then use the `sn-` classes or the React component of the same name. If something is missing, add a component here first, then build it.

## Tokens

Every value lives in `apps/web/app/styles/tokens.css` as a CSS variable: dark values on `:root`, light values under `prefers-color-scheme: light` (unless the page pinned dark) and under `[data-theme="light"]`. The Tailwind theme only knows these variables, so stock colour classes such as `zinc-*` or `red-*` do not exist. Components read the variables; a fork edits the values.

### Colour

| Token | Use |
| --- | --- |
| `bg` | Page ground. |
| `surface` | Cards, code blocks, table header bands, the status banner in its neutral state. |
| `surface-raised` | Popovers, dialogs, tags, unselected segments, inputs. |
| `overlay` | Hover wash on rows, ghost buttons and nav links. |
| `scrim` | Backdrop behind a dialog. |
| `border` | Dividers and card outlines. Decorative only: never the sole edge of a control. |
| `border-strong` | Input, select, checkbox and secondary-button outlines; 3:1 on `bg`, `surface` and `surface-raised`. |
| `fg` | Primary text and test names. |
| `fg-muted` | Secondary text, values in tables, nav links at rest. |
| `fg-subtle` | Labels, column headers, timestamps, hints. The lightest text colour allowed. |
| `primary` | Fill of the primary button and of the selected segment or filter. |
| `on-primary` | Text on `primary`. |
| `accent` | Territorial's emerald: the logo's signal, the focus ring and the active nav underline. Never a button fill or link colour, since emerald also means Operational. |
| `operational` | The word Operational, Recovered text and uptime figures at 100%. |
| `operational-solid` | Operational marks: status disc, history cells. |
| `operational-tint` | Ground of an Operational chip or banner. |
| `degraded` | The word Degraded and warning text. |
| `degraded-solid` | Degraded marks: status triangle, history cells with mixed results. |
| `degraded-tint` | Ground of a Degraded chip, banner or warning callout. |
| `outage` | The word Outage, error text and destructive actions. |
| `outage-solid` | Outage marks: status square, history cells where every run failed. |
| `outage-tint` | Ground of an Outage chip, banner or error callout. |
| `unknown-solid` | Marks for No data and Paused. The word itself is set in `fg-subtle`. |
| `strip-empty` | History cells with no runs, and loading skeletons. |

Every text token meets 4.5:1 on `bg`, `surface` and `surface-raised` (and the state words on their own tint) in both themes. Keep that true when changing values.

### Type styles

| Style | Family | Size / line, weight | Use |
| --- | --- | --- | --- |
| `metric` | mono | 36 / 40px, 600 | The uptime figure on a status card or public test page. One per card. |
| `page-title` | mono | 24 / 32px, 600 | The h1 of every page: a test name, an incident title, a page name. |
| `wordmark` | mono | 20 / 24px, 600 | The product name beside the mark. Always lowercase. |
| `title` | mono | 18 / 28px, 600 | Banner headline, dialog title, card title on the public list view. |
| `data` | mono | 14 / 20px, 400 | Default interface text: table cells, nav, buttons, inputs, values. |
| `data-sm` | mono | 12 / 16px, 400 | Tags, chips, secondary lines in a row, timestamps. |
| `section-title` | mono | 12 / 16px, 600 | Section headings on dashboard and status page. Uppercase. |
| `label` | mono | 11 / 16px, 500 | Field labels, column headers, definition terms. Uppercase. The smallest size in the system. |
| `code` | mono | 13 / 20px, 400 | Test code, error messages, token and secret names. |
| `prose-heading` | sans | 18 / 28px, 600 | Headings inside an incident report. |
| `body` | sans | 15 / 24px, 400 | Incident reports and updates, descriptions, empty states, dialog copy. Lines at most 68 characters. |
| `body-sm` | sans | 13 / 20px, 400 | Field hints, section descriptions, callout text. |

### Spacing, radius, shadow, layout

| Token | Value | Use |
| --- | --- | --- |
| `space-1` | 4px | Gap between tags; between a status mark and its word. |
| `space-2` | 8px | Inside chips and small buttons; gap between controls in a group. |
| `space-3` | 12px | Table cell padding; status card padding. |
| `space-4` | 16px | Field stack gap; card padding on the public list view; phone gutter. |
| `space-6` | 24px | Desktop gutter; gap between nav links; dialog padding. |
| `space-8` | 32px | Gap between sections on a page. |
| `space-12` | 48px | Top and bottom padding of a page. |
| `radius-xs` | 1px | History strip cells. |
| `radius-sm` | 2px | Buttons, inputs, tags, chips, segments. The system is square by default. |
| `radius-md` | 8px | Cards, code blocks, popovers, dialogs, banners. |
| `radius-full` | 9999px | The Operational disc and the switch only. |
| `shadow-popover` | per theme | Popovers, dialogs and the bulk bar. Cards are flat. |
| `page-max` | 1180px | Maximum content width of every page, centred. |
| `form-max` | 672px | Maximum width of settings pages and forms. |
| `prose-max` | 68ch | Maximum width of incident report text. |

## Components

Each component below has a React component of the same name in `apps/web/app/_components/ui/` and its `sn-*` classes in `components.css`. Server Components by default; client code only where the component needs the browser.

### AppHeader

The one header for every signed-in page (everything under `/admin`), rendered once by the admin layout.

- **Order:** Tests, Incidents, Notifications, Secrets, API tokens, Status page. "Status page" opens the public page and carries `↗`.
- **Current page:** `aria-current="page"`; `fg` text with a 2px `accent` underline. This and the logo are the only places `accent` appears in the shell.
- **Incidents count:** shown only while incidents are open, in `outage` on `outage-tint`.
- **Right side:** Sign out and one primary button, "New test". Search lives on the Tests page, not in the header.
- Labels are sentence case. The page that issues agent tokens is "API tokens"; it explains MCP.
- Below 640px the nav wraps under the brand; nothing collapses into a menu.

The consumer provides the current route and the open-incident count.

### Button

Four kinds: primary, secondary, ghost and danger, in two sizes.

- **Primary** (`primary` fill): the one action that completes the page. At most one per view.
- **Secondary** (`border-strong` outline): other real actions: Run now, Add note, Send test message.
- **Ghost** (text in `fg-muted`): Cancel, Edit, Hide, and row-level actions.
- **Danger** (`outage` text and outline): Delete, Revoke. Always confirmed in a Dialog.
- **Small** for actions inside rows and section headers.
- Labels are a verb and an object in sentence case. While working, the label changes ("Saving…") and the button is disabled.
- All buttons are `radius-sm`. Focus shows a 2px `accent` ring, offset 2px.

### Callout

An inline message about the state of the page: a missing server setting, a failed request, a draft.

- **Degraded** tint for something the operator should fix (optional config missing); **outage** tint for a failed request; neutral for information.
- First words in bold mono name the condition; the sentence after says what to do.
- Sits at the top of the content it concerns, full width. Not dismissible: it leaves when the condition does.
- Every page that fetches data shows the outage callout when the request fails, so a failed fetch never reads as an empty list.

### ChannelRouting

One notification channel assigned to a test or tag, with the events it receives.

- **Row:** channel name, its type as a neutral Tag ("slack bot", "discord webhook", "email", "webhook"), then three toggles.
- **Toggles:** Outage, Degraded, Recovered, each with its shape, spelled out.
- Channel types have no colours of their own; colour is for state only.
- A toggle saves immediately and reverts with a Callout if the save fails.
- On a test page the same row is read-only and says where the assignment comes from ("via tag tier:core").

### CodeBlock

Read-only test code, error output and copyable commands.

- `code` style on `surface` with a `border` and `radius-md`. Long lines scroll inside the block.
- Comments in `fg-subtle`. No syntax colours beyond that: the palette has no spare hues.
- The editor (Monaco, always dynamically imported) uses the same ground, border and font so the read and edit views match; its theme is built from `bg`, `surface`, `fg`, `fg-subtle` for both themes.
- Error messages from a run use this block with `outage` text for the first line.
- Examples follow the real signatures, for example `ctx.assert(name, value, message?)`.

### DefinitionGrid

Label-and-value pairs for a record's settings: a test's configuration, an incident's details.

- Term in `label`, value in `data`. Values carry their unit ("5 min", "3 runs"), never a bare number.
- Columns fill at 140px minimum; the grid wraps on its own.
- State values use words, not colour: "Active" / "Paused".
- Leave out fields that do nothing (such as the compatibility-only `uses_browser`).

### Dialog

A confirmation for an action that cannot be undone or that makes something public.

- Used for: delete a test, channel or secret; revoke a token; bulk actions over 20 tests; publish an incident or report.
- **Title** is the question ("Delete this test?"). **Body** in `body` says exactly what will happen, with counts. **Confirm** repeats the verb ("Delete test"); it is danger-styled for deletions and primary for publishing.
- `surface-raised` on `scrim`, `radius-md`, `shadow-popover`. Focus starts on Cancel and is trapped; `Esc` cancels.
- Built on the Radix alert dialog.

### EmptyState

What a list shows before it has anything in it.

- A mono title that names the absence, one or two sentences in `body` saying what the thing is, and the action that creates the first one.
- Where an agent can do it, say so and link to API tokens: Sentinel is built to be driven through MCP.
- Dashed `border-strong` outline, left-aligned. No illustration.
- A filter with no matches is not an empty state: show "No tests match "radar"." with a Clear link.

### Field

A labelled input with its hint or error; also the checkbox and the switch.

- **Label** above the control in `label`, with the unit in the label ("Timeout (seconds)").
- **Control:** `bg` ground, `border-strong` outline, `radius-sm`, 36px tall.
- **Hint** in `body-sm`, `fg-subtle`: one sentence on what the value does.
- **Error** replaces the hint, in `outage`, and says how to fix it. The control gets `aria-invalid` and an `outage` border.
- **Switch** for a setting that applies on save ("Scheduled"); **checkbox** for picking rows or options in a list.
- Forms are one column, `form-max` wide, fields `space-4` apart. Primary button at the bottom left, Cancel beside it.

### HistoryStrip

A row of equal cells, one per time bucket, coloured by the worst result in that bucket.

- **Cells:** `operational-solid` when every run passed, `degraded-solid` when results were mixed, `outage-solid` when every run failed, `strip-empty` for no runs.
- **Regular** (28px) on public cards and test pages, with the axis line and the uptime figure. **Compact** (14px) in table rows and grid cards.
- 30 cells for 30 days; 100 for 1 h, 24 h and 7 d; grid cards sample down to 30.
- Hover or focus on a cell shows its time range and run counts. On touch, tapping the strip opens the test page instead.
- Loading state: all cells `strip-empty`, pulsing. No spinner.

The consumer provides the buckets and the period.

### IncidentBanner

A published incident on the public status page: severity, state, title, latest public update and timing.

- Appears under the StatusBanner only after someone publishes the incident. Until then the public page shows the affected checks in their sections and nothing else.
- **Open incidents** take the tint of their worst state. **Resolved** ones are neutral and listed under "Incidents in the last 30 days".
- **Latest update** is the most recent published note, in `body`. If there is none, the line is omitted.
- **Meta:** start and duration, number of checks affected, last update time. Times in UTC unless the visitor switched to Local.
- The whole banner links to the public incident page.
- Signed in, the same row appears on `/admin/incidents` with a visibility chip: Internal, Published.

### IncidentReport

The written account of an incident: Summary, Impact, Root cause, Resolution, Follow-ups.

- Set in the prose styles (`prose-heading`, `body`) at `prose-max` width. This is the one place in Sentinel that reads as a document.
- **Two versions** of each section, Internal and Public, switched with a SegmentedControl. The public version leaves out hostnames, pod names and people.
- **States:** no report, Draft report, Report published. Publishing opens a Dialog that previews exactly the public text.
- The report keeps the incident's duration, affected tests and failed-run counts as stored numbers, so it outlives run retention.
- Markdown in, rendered as paragraphs, lists, links and inline code by a small hand-written renderer. No images.

### IncidentState

Where an incident is in its life, and who can see it.

- **States, in order:** Investigating, Identified, Monitoring, Resolved. Sentinel opens an incident in Investigating when a test reaches Outage, and moves it to Resolved when every linked test has recovered. People and agents set the middle two.
- The current state uses `primary`; earlier ones are filled squares, later ones hollow.
- Changing state writes a system entry to the timeline.
- **Visibility chips:** Internal (default), Published; Draft report, Report published. Agents can write notes and draft reports through MCP; only a signed-in person can publish.

### IncidentTimeline

The ordered record of an incident: entries Sentinel writes itself and notes people or agents add.

- **System entries** (state changes of linked tests, incident state changes, publishing) are one mono line in `fg-muted`.
- **Notes** are prose in `body`, followed by the author (the operator's name, "agent · mcp" or a token label) and a visibility chip.
- Oldest first. Time in the left column in tabular figures; on a phone it moves above the entry.
- The public incident page shows system entries about state and the Published notes only.
- The note composer sits under the list: a textarea, a "Show on status page" checkbox (off by default) and "Add note".

### LatencyChart

Response time of one test over the selected period, with problem windows marked under the line.

- **Line** in `fg-muted`, 1.5px, with an `overlay` area and an emphasised endpoint in `fg`. The line is neutral: the state colours belong to the event bars, not to latency.
- **Events:** a 5px bar under the plot for each Degraded or Outage window, in that state's solid colour, labelled with its start.
- Three horizontal grid lines in `border`; ticks in `label` size, `fg-subtle`; the y axis starts at 0.
- Built on Recharts (dynamically imported), coloured from the tokens, never from hard-coded hex values.

### Logo

The Beacon and its lockup with the wordmark.

A mast and a signal standing on Territorial's tile: one 3.5-unit round stroke on a 64-unit grid, the outline in `fg`, the signal in `accent`.

- **Lockup:** the mark at 28px beside the word `sentinel` in the `wordmark` style, 10px apart. The word is always lowercase.
- **Mark alone:** favicon, the sign-in page, the public footer, Slack and Discord bot avatars.
- **Minimum size:** 16px. Below 24px drop the outer signal arcs.
- **Colour:** only `fg` + `accent`. Never recolour the signal to a state colour.
- Use `apps/web/assets/Logos/sentinel-beacon-on-dark.svg` and `-on-light.svg` for files; inline the SVG with the `sn-logo` classes when it must follow the theme.
- Don't place the Territorial symbol beside it. Territorial appears as the text `territorial.dev` in the public footer.

### PageHeader

Back link, title, state line and actions at the top of a detail page.

- **Back link:** names where it goes ("← Tests", "← Incidents"), never "← back".
- **Title:** `page-title`, one per page.
- **Meta line:** the status chip first, then the "since" text, then tags.
- **Actions:** at most one primary. Order: quiet actions, destructive, primary.
- The header ends with a `border` rule; sections start `space-8` below it.

### PublicHeader

Header and footer of the public pages (`/`, `/status/[tag]`, `/status/tests/[id]`, `/status/incidents/[id]`).

Public pages never show the signed-in nav. They are the product's face: readable by someone who has never seen Sentinel.

- **Title:** the instance or tag title in `page-title`, from `STATUS_PAGE_TITLE`. A fork sets it; there is no branding setting in the UI.
- **Tags:** filter pills under the title; the selected one uses `primary`.
- **Theme:** Light / Dark / System, default System. Stored per browser and applied before paint.
- **Footer:** the timezone and refresh note on the left; "Powered by sentinel, open source from territorial.dev" on the right. Forks may change the right side.
- No sign-in link, no test code, no error messages, no internal notes on any public page.

### SearchAndBulk

The search box above the dashboard and the toolbar that appears when rows are selected.

- **Search** filters as you type on name and tags, across every section; sections with no match hide. `/` focuses it, `Esc` clears it. The count beside it reads "4 of 148 tests".
- The query goes in the URL (`?q=`) next to `?tag=`.
- **Bulk bar** appears, fixed to the bottom of the viewport, once a row is selected. It shows the count and: Run now, Pause, Resume, Add tag…, Delete…, Clear.
- Delete and anything touching more than 20 tests is confirmed in a Dialog that names the count.
- Each bulk action is one call to `POST /tests/bulk`, the same as the MCP tool `bulk_update_tests`, so agents and the UI share it.

### SectionHeader

The summary chips and section headings that stack a page by state.

Sections, in order: **Outage**, **Degraded**, **Recovered in the last 24 hours**, **Operational**, **Paused**.

- **Chips:** one per visible section, each a link to it, with the state's shape and a count.
- **Heading:** shape, title in `section-title`, count, and a one-line description at the right in `body-sm`.
- Outage, Degraded and Recovered always show, with an empty line when they hold nothing ("Nothing is failing."). Operational and Paused are collapsed behind "Show all N" and hidden when empty. On public pages Operational is expanded and Paused is not shown.
- The same component serves the dashboard table, the status grid and the incident list (Open, Resolved in the last 30 days).

### SegmentedControl

A small set of mutually exclusive choices: period, grid or list, UTC or local time, internal or public version.

- Two to five options; the selected one uses `primary` / `on-primary`, the rest `surface-raised`.
- Options are words or short values ("24 h", "Grid"), not bare icons.
- The choice is written to the URL so a shared link opens the same view.
- Each button carries `aria-pressed`; the group has a label.

### StatusBanner

The one-line answer at the top of a public status page: is everything working?

- One banner per page, directly under the header, above the summary chips.
- **Wording:** "All systems operational"; "N checks degraded"; "Outage on N checks" (append ", M degraded" when both). The worst state sets the colour.
- **Meta:** the number of checks on this page and how long ago the data was fetched.
- Tests are called "checks" on public pages and "tests" when signed in.
- The banner states what Sentinel measured. Published incidents appear below it as IncidentBanner; an unpublished incident changes nothing here beyond the counts.

### StatusCard

One check on the public status grid: name, uptime for the period, state with its since line, and a compact history strip.

- The whole card is a link to the public check page.
- **Name** has the first line to itself, so most names fit at 220px; longer ones end in an ellipsis with the full name in `title`.
- **Metric:** uptime for the selected period with one decimal, period label beside it.
- **State line:** the StatusIndicator, then the since text in `fg-subtle` ("failing for 2 h 27 min", "no problems in 7 d"). Always present, so cards keep one height.
- Flat: `surface`, `border`, `radius-md`. Hover changes the border to `border-strong`. No hover popover; the detail lives on the check page.
- Grid columns are `minmax(220px, 1fr)`; one column on a phone.

### StatusIndicator

The state of a test as a shape and a word: Operational, Degraded, Outage, Recovered, No data, Paused. This is the single vocabulary wherever a person reads a test's state: dashboard, status page, notifications, MCP text and docs.

| State | Shape | Means |
| --- | --- | --- |
| Operational | disc | Last run passed and nothing went wrong in 24 h |
| Degraded | triangle | A warning now, or failing but under the failure threshold |
| Outage | square | Failing for at least the failure threshold |
| Recovered | ring | Operational now, with a problem in the last 24 h |
| No data | grey ring | No runs yet |
| Paused | bar | Not scheduled |

- Never show the colour without the shape and the word; the shapes are what a colour-blind reader uses.
- **Plain** in tables and lists; **chip** in page headers and incident rows.
- **Run results** are a separate, lower level: Passed, Warned, Failed, Timed out. They appear only in a test's run history, with the same three shapes.
- Notification events use the same words: Outage, Degraded, Recovered.

### Tag

A free-form label on a test; also the filter pill at the top of the dashboard and status page.

- Tags written `key:value` show the key in `fg-subtle` and the value in `fg`, so `layer:` and `tier:` families scan as columns.
- A tag is a link: it filters the current page (dashboard) or opens `/status/[tag]` (public).
- The selected filter uses `primary` / `on-primary`, never emerald, which is reserved for Operational.
- When tags overflow a row, the rest collapse into `+N`, which opens the full list on hover and focus.

### TestTable

The dashboard's table of tests: one row per test, inside a section.

- **Columns:** select, Name (with tags), Status, Since, Last run, Avg response, History. Numbers are right-aligned with tabular figures.
- **Name** is the link to the test. Tags follow it and filter the dashboard when clicked. A test in an open incident carries an incident chip.
- **Since** is two lines: the state's duration in the state colour, then a `fg-subtle` detail.
- **Select** column feeds the bulk bar (see SearchAndBulk). It appears on hover or focus and stays visible once any row is selected.
- Column headers sort within the section; the section's own order is the default.
- The table scrolls sideways inside its own wrapper below 980px; the page never does.
- Rows are 44px tall. Row hover uses `overlay`.

### Adding a component

If a screen needs something this list does not have, add it here first (purpose, rules, which tokens it uses), then build it in `components.css` and `_components/ui/`, then use it. A fork adds its own components in its own files rather than editing these, so upstream changes merge cleanly.
