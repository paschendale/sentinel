'use client'

import { useState, type ReactNode } from 'react'
import type { ProblemWindow, StatusSection } from '@sentinel/shared'
import { STATUS_SECTIONS, compareInSection } from '@sentinel/shared'
import type { SinceText } from '@sentinel/shared'
export { sinceText, formatDuration } from '@sentinel/shared'
export type { SinceText } from '@sentinel/shared'

interface SectionMeta {
  title: string
  short: string
  description: string
  dot: string
  titleClass: string
  empty: string | null
  collapsedByDefault: boolean
}

export const SECTION_META: Record<StatusSection, SectionMeta> = {
  critical: {
    title: 'Critical failures',
    short: 'Critical',
    description: 'Failing for at least the test’s failure threshold. Newest first.',
    dot: 'bg-red-500',
    titleClass: 'text-red-300',
    empty: 'Nothing is failing.',
    collapsedByDefault: false,
  },
  warning: {
    title: 'Warnings',
    short: 'Warnings',
    description: 'A warning now, or failing but still under the failure threshold.',
    dot: 'bg-yellow-500',
    titleClass: 'text-yellow-200',
    empty: 'No warnings.',
    collapsedByDefault: false,
  },
  recovered: {
    title: 'Recoveries in the last 24 hours',
    short: 'Recovered in 24 h',
    description: 'Passing now, had a warning or failure in the last 24 h. Most recent first.',
    dot: 'bg-emerald-400',
    titleClass: 'text-emerald-200',
    empty: 'No recoveries in the last 24 hours.',
    collapsedByDefault: false,
  },
  clean: {
    title: 'No problems reported in the last 24 hours',
    short: 'No problems',
    description: 'Every run in the last 24 h passed. Alphabetical.',
    dot: 'bg-zinc-600',
    titleClass: 'text-zinc-300',
    empty: null,
    collapsedByDefault: true,
  },
  disabled: {
    title: 'Disabled',
    short: 'Disabled',
    description: 'Not scheduled.',
    dot: 'bg-zinc-700',
    titleClass: 'text-zinc-400',
    empty: null,
    collapsedByDefault: true,
  },
}

type Sectioned = ProblemWindow & { name: string; section: StatusSection }

/** Groups tests by section, each group in its in-section order. */
export function groupBySection<T extends Sectioned>(tests: T[]): Record<StatusSection, T[]> {
  const out = Object.fromEntries(STATUS_SECTIONS.map((s) => [s, [] as T[]])) as Record<StatusSection, T[]>
  for (const t of tests) out[t.section].push(t)
  for (const s of STATUS_SECTIONS) out[s].sort((a, b) => compareInSection(s, a, b))
  return out
}

/** Sections that are shown: the first three always (with an empty line), the last two only when they hold tests. */
export function visibleSections(groups: Record<StatusSection, unknown[]>): StatusSection[] {
  return STATUS_SECTIONS.filter((s) => SECTION_META[s].empty !== null || groups[s].length > 0)
}

export const SINCE_TONE_CLASS: Record<SinceText['tone'], string> = {
  critical: 'text-red-300',
  warning: 'text-yellow-200',
  recovered: 'text-emerald-200',
  muted: 'text-zinc-500',
}

/** Count chips at the top of a page; each jumps to its section. */
export function SectionSummary({ groups }: { groups: Record<StatusSection, unknown[]> }) {
  return (
    <nav aria-label="Sections" className="flex flex-wrap gap-2">
      {visibleSections(groups).map((s) => (
        <a
          key={s}
          href={`#section-${s}`}
          className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 transition-colors"
        >
          <span className={`h-2 w-2 rounded-full ${SECTION_META[s].dot}`} />
          {SECTION_META[s].short}
          <span className="font-semibold tabular-nums text-zinc-100">{groups[s].length}</span>
        </a>
      ))}
    </nav>
  )
}

/** One stacked section: header with count and description, then its content or an empty line. */
export function SectionBlock({
  section,
  count,
  children,
}: {
  section: StatusSection
  count: number
  children: ReactNode
}) {
  const meta = SECTION_META[section]
  const [open, setOpen] = useState(!meta.collapsedByDefault)
  return (
    <section id={`section-${section}`} className="scroll-mt-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-zinc-800 pb-2.5">
        <span className={`h-2 w-2 self-center rounded-full ${meta.dot}`} />
        <h2 className={`text-xs font-semibold uppercase tracking-widest ${meta.titleClass}`}>{meta.title}</h2>
        <span className="text-xs tabular-nums text-zinc-500">{count}</span>
        <span className="ml-auto text-xs text-zinc-500">{meta.description}</span>
      </div>
      {count === 0 ? (
        <p className="py-3 text-sm text-zinc-500">{meta.empty}</p>
      ) : open ? (
        <div className="pt-2">{children}</div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 hover:border-zinc-600 hover:text-zinc-100 transition-colors"
        >
          Show all {count}
        </button>
      )}
      {open && meta.collapsedByDefault && count > 0 && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Hide
        </button>
      )}
    </section>
  )
}
