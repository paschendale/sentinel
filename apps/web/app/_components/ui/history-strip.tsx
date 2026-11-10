'use client'

import { useRouter } from 'next/navigation'
import { useState, type KeyboardEvent } from 'react'
import type { StatusBucket, StatusPeriod } from '@sentinel/shared'
import { PERIOD_START_LABELS, bucketKind, dateTime, plural, sampleBuckets, shortDate } from '../../../lib/format'
import { useTimeZone } from './time-zone'

const CELLS: Record<StatusPeriod, number> = { '1h': 100, '24h': 100, '7d': 100, '30d': 30 }

function range(b: StatusBucket, period: StatusPeriod, tz: 'utc' | 'local'): string {
  if (period === '30d') return shortDate(b.bucket_start, tz)
  return `${dateTime(b.bucket_start, tz)} – ${dateTime(b.bucket_end, tz).replace(/^.*, /, '')}`
}

/**
 * One cell per time bucket, coloured by its runs: all passed, mixed, all failed, none.
 * Regular (28px) with an axis on cards and test pages; compact (14px) in rows and grid cards.
 * `buckets: null` is the loading state. Hover or focus shows a cell's time range and counts;
 * `href` makes a tap open the test page instead (touch has no hover).
 */
export function HistoryStrip({
  buckets,
  period,
  compact,
  cells,
  axis,
  href,
  tooltips = true,
  label = 'Status history',
}: {
  buckets: StatusBucket[] | null
  period: StatusPeriod
  compact?: boolean
  /** Sample down to this many cells (grid cards use 30). */
  cells?: number
  axis?: boolean
  href?: string
  tooltips?: boolean
  label?: string
}) {
  const { tz } = useTimeZone()
  const router = useRouter()
  const [hover, setHover] = useState<number | null>(null)
  const count = cells ?? CELLS[period]
  const shown = buckets === null ? null : sampleBuckets(buckets, count)

  const cls = `sn-strip${compact ? ' sn-strip--compact' : ''}${shown === null ? ' sn-strip--loading' : ''}`
  if (shown === null || shown.length === 0) {
    return (
      <div className="sn-stripbox">
        <div className={cls} role="img" aria-label={shown === null ? `${label}: loading` : `${label}: no runs`}>
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className="sn-strip__cell" />
          ))}
        </div>
        {axis && <Axis period={period} />}
      </div>
    )
  }

  const active = hover !== null ? shown[hover] : undefined
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? shown!.length) - 1))
    else if (e.key === 'ArrowRight') setHover((h) => Math.min(shown!.length - 1, (h ?? -1) + 1))
    else if (e.key === 'Escape') setHover(null)
    else return
    e.preventDefault()
  }

  return (
    <div className="sn-stripbox">
      <div
        className={cls}
        role="img"
        aria-label={label}
        tabIndex={tooltips ? 0 : undefined}
        onKeyDown={tooltips ? onKey : undefined}
        onFocus={tooltips ? () => setHover(shown.length - 1) : undefined}
        onBlur={() => setHover(null)}
        onMouseLeave={() => setHover(null)}
        onPointerUp={(e) => {
          if (href && e.pointerType === 'touch') router.push(href)
        }}
        style={href ? { cursor: 'pointer' } : undefined}
      >
        {shown.map((b, i) => (
          <span key={b.bucket_start} className={`sn-strip__cell sn-strip__cell--${bucketKind(b)}`} onMouseEnter={tooltips ? () => setHover(i) : undefined} />
        ))}
      </div>
      {tooltips && active && hover !== null && (
        <div className="sn-tip" style={{ left: `${Math.min(Math.max((hover / shown.length) * 100 - 10, 0), 70)}%` }} role="status">
          <b>{range(active, period, tz)}</b>
          {active.success_count + active.warn_count + active.failure_count === 0 ? (
            'No runs'
          ) : (
            <>
              {plural(active.success_count + active.warn_count + active.failure_count, 'run')}: {active.success_count} passed
              {active.warn_count > 0 ? `, ${active.warn_count} warned` : ''}
              {active.failure_count > 0 ? `, ${active.failure_count} failed` : ''}
            </>
          )}
        </div>
      )}
      {axis && <Axis period={period} />}
    </div>
  )
}

function Axis({ period }: { period: StatusPeriod }) {
  return (
    <div className="sn-strip__axis">
      <span>{PERIOD_START_LABELS[period]}</span>
      <span>{period === '30d' ? 'today' : 'now'}</span>
    </div>
  )
}
