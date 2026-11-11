'use client'

import { useEffect, useState } from 'react'
import { plural, relativeTime } from '../../../lib/format'
import { Mark } from './status-indicator'

/**
 * The one-line answer at the top of a public status page. The worst state sets the colour:
 * "All systems operational", "N checks degraded", "Outage on N checks, M degraded".
 */
export function StatusBanner({ outage, degraded, total, fetchedAt }: { outage: number; degraded: number; total: number; fetchedAt: string }) {
  const kind = outage > 0 ? 'outage' : degraded > 0 ? 'degraded' : 'operational'
  const title =
    outage > 0
      ? `Outage on ${plural(outage, 'check')}${degraded > 0 ? `, ${degraded} degraded` : ''}`
      : degraded > 0
        ? `${plural(degraded, 'check')} degraded`
        : 'All systems operational'
  return (
    <div className={`sn-banner sn-banner--${kind}`}>
      <Mark kind={kind} />
      <h2 className="sn-banner__title">{total === 0 ? 'No checks yet' : title}</h2>
      <span className="sn-banner__meta">
        {plural(total, 'check')} · updated <Ago iso={fetchedAt} />
      </span>
    </div>
  )
}

/** "40 s ago", kept current. */
export function Ago({ iso }: { iso: string }) {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(id)
  }, [])
  return <span suppressHydrationWarning>{now ? relativeTime(iso, now) : 'just now'}</span>
}
