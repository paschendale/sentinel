Sentinel is an open-source synthetic testing and uptime monitor from territorial.dev. It runs JavaScript tests on a schedule and publishes what it finds on a public status page. Design for that public page first: a visitor who has never seen Sentinel should know in one glance whether things work. The signed-in side is for one operator and their agents; keep it dense, consistent and quiet.

## Principles

1. **The public page is the product.** Decide how a thing looks on `/status` before deciding how it looks signed in. Both sides use the same components.
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
| status page | public dashboard | The public pages under `/status` |
| API tokens | mcp, tokens | The page that issues tokens for agents |

Degraded covers two cases: the test raised a warning, or it is failing but still under its failure threshold. Say which in the "since" line ("1 of 3 failures"), not with a different word.

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
- One `page-title` per page. Sections are headed in `section-title`. Fields and columns are labelled in `label`.
- Numbers that line up use tabular figures. Nothing is smaller than 11px.

## Layout

- Pages are centred at `page-max`, with a `space-6` gutter (`space-4` on a phone) and `space-12` above and below. Forms and settings are `form-max`; report text is `prose-max`.
- Sections are `space-8` apart and stacked by state: Outage, Degraded, Recovered, Operational, Paused.
- Corners are `radius-sm` on controls and `radius-md` on cards, code, dialogs and banners. The only round things are the Operational disc and the switch.
- Surfaces are flat. `shadow-popover` is for popovers, dialogs and the bulk bar.
- Every page works at 400px wide. Tables scroll inside their own wrapper; cards go to one column.
- Motion is limited to colour transitions of 150ms and the loading pulse on history cells. Respect `prefers-reduced-motion`.

## Iconography

Sentinel has no icon set. It uses:

- the three state shapes (disc, triangle, square) plus ring and bar, drawn in CSS by `sn-mark`;
- typographic arrows: `←` on back links, `↗` on links that leave the app, `→` for "view details";
- the `sn-kbd` key cap for shortcuts.

Use a word where an icon would go. If a control truly needs a pictogram, draw it inline at 14px with a 1.5px stroke in `currentColor`.

## Logo

The mark is the Beacon: a mast and signal on Territorial's tile, outline in `fg`, signal in `accent`. The lockup is the mark at 28px and the word `sentinel` in the `wordmark` style. Files are in `assets/Logos`. Territorial is credited in text in the public footer, not with its symbol.

## Routes

- `/` is the public status page. A visitor never lands on a sign-in form. `/status/...` keeps working for tag pages, checks and incidents.
- Everything signed in lives under `/admin`: `/admin` is the sign-in page (and sends a signed-in operator to `/admin/tests`), then `/admin/tests`, `/admin/incidents`, `/admin/notifications`, `/admin/secrets`, `/admin/tokens`.
- Public pages carry no link to `/admin`. Old signed-in paths redirect to their `/admin` equivalents.

## Forks and agents

- A fork that builds on Sentinel (a station map, a client's own monitor) changes token values and adds its own pages and components. It does not edit the shared components, so it can keep pulling from upstream.
- Sentinel is developed mostly by agents. When building a screen: read this page, then the component's guidelines, then use the `sn-` classes or the React component of the same name. If something is missing, add a component here first, then build it.
