'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { StatusSection } from '@sentinel/shared'
import { SECTION_KIND, SECTION_META, type StateKind } from '../../../lib/states'
import { Mark } from './status-indicator'
import { Button } from './button'

/** One summary chip per visible section, each a link to it, with its shape and count. */
export function SectionChips({ items }: { items: Array<{ id: string; kind: StateKind; label: string; count: number }> }) {
  return (
    <nav className="sn-chips" aria-label="Sections">
      {items.map((c) => (
        <a key={c.id} className="sn-chip" href={`#${c.id}`}>
          <Mark kind={c.kind} />
          {c.label} <b>{c.count}</b>
        </a>
      ))}
    </nav>
  )
}

/** Chips for the test sections that are shown. */
export function StateSectionChips({ sections, counts, prefix }: { sections: StatusSection[]; counts: Record<StatusSection, number>; prefix: string }) {
  return (
    <SectionChips
      items={sections.map((s) => ({ id: `${prefix}${s}`, kind: SECTION_KIND[s], label: SECTION_META[s].chip, count: counts[s] }))}
    />
  )
}

/** Shape, title, count and a one-line description. */
export function SectionHeader({ kind, title, count, description }: { kind: StateKind; title: string; count?: number; description?: string }) {
  return (
    <div className="sn-section__head">
      <Mark kind={kind} />
      <h2 className="sn-section__title">{title}</h2>
      {count !== undefined && <span className="sn-section__count">{count}</span>}
      {description && <span className="sn-section__desc">{description}</span>}
    </div>
  )
}

/**
 * A section of a page stacked by state. Shows `empty` when there is nothing; `collapsible`
 * sections hide behind "Show all N" until opened.
 */
export function Section({
  id,
  kind,
  title,
  count,
  description,
  empty,
  collapsible,
  forceOpen,
  children,
}: {
  id?: string
  kind: StateKind
  title: string
  count: number
  description?: string
  empty?: string | null
  collapsible?: boolean
  /** Open regardless of `collapsible` (e.g. while searching). */
  forceOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  // A summary chip links to #id: opening a collapsed section when it is the target.
  useEffect(() => {
    if (!id || !collapsible) return
    const check = () => {
      if (window.location.hash === `#${id}`) setOpen(true)
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [id, collapsible])
  const shown = !collapsible || open || forceOpen
  return (
    <section className={`sn-section sn-section--${kind}`} id={id}>
      <SectionHeader kind={kind} title={title} count={count} description={description} />
      {count === 0 ? (
        <p className="sn-emptyline">{empty}</p>
      ) : shown ? (
        <>
          <div className="sn-secbody">{children}</div>
          {collapsible && !forceOpen && (
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Hide
            </Button>
          )}
        </>
      ) : (
        <Button variant="secondary" size="sm" className="sn-show" onClick={() => setOpen(true)}>
          Show all {count}
        </Button>
      )}
    </section>
  )
}
