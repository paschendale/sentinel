'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './button'

/**
 * The search box over the dashboard: filters on name and tags as you type. `/` focuses it,
 * `Esc` clears it.
 */
export function SearchBox({ value, onChange, placeholder = 'Search tests and tags', label = 'Search tests' }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement | null)?.isContentEditable
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        ref.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <label className="sn-search">
      <input
        ref={ref}
        className="sn-input"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onChange('')
            e.currentTarget.blur()
          }
        }}
      />
      <span className="sn-kbd" aria-hidden="true">
        /
      </span>
    </label>
  )
}

export interface BulkAction {
  id: string
  label: string
  variant?: 'secondary' | 'danger'
  /** Asks for a tag before running. */
  needsTag?: boolean
}

/**
 * The toolbar fixed to the bottom of the viewport while rows are selected: the count, then the
 * actions, then Clear. `message` reports the last action's outcome.
 */
export function BulkBar({
  count,
  actions,
  onAction,
  onClear,
  busy,
  message,
}: {
  count: number
  actions: BulkAction[]
  onAction: (id: string, tag?: string) => void
  onClear: () => void
  busy?: boolean
  message?: ReactNode
}) {
  const [asking, setAsking] = useState<BulkAction | null>(null)
  const [tag, setTag] = useState('')
  if (count === 0 && !message) return null
  return (
    <div className="sn-bulkwrap">
      <div className="sn-bulk" role="toolbar" aria-label="Bulk actions">
        <span className="sn-bulk__count" aria-live="polite">
          {count > 0 ? `${count} selected` : message}
          {count > 0 && message ? <span className="sn-subtle"> · {message}</span> : null}
        </span>
        {count > 0 &&
          (asking ? (
            <form
              className="sn-bulk__form"
              onSubmit={(e) => {
                e.preventDefault()
                if (tag.trim()) {
                  onAction(asking.id, tag.trim())
                  setAsking(null)
                  setTag('')
                }
              }}
            >
              <input className="sn-input" autoFocus value={tag} onChange={(e) => setTag(e.target.value)} placeholder="tag, e.g. tier:critical" aria-label="Tag" maxLength={50} />
              <Button type="submit" size="sm" variant="secondary" disabled={busy || !tag.trim()}>
                {asking.label.replace('…', '')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
                Cancel
              </Button>
            </form>
          ) : (
            actions.map((a) => (
              <Button key={a.id} size="sm" variant={a.variant ?? 'secondary'} disabled={busy} onClick={() => (a.needsTag ? setAsking(a) : onAction(a.id))}>
                {a.label}
              </Button>
            ))
          ))}
        <Button size="sm" variant="ghost" onClick={onClear}>
          {count > 0 ? 'Clear' : 'Dismiss'}
        </Button>
      </div>
    </div>
  )
}
