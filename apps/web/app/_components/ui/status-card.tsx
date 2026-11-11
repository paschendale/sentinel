import Link from 'next/link'
import type { StatusBucket, StatusPeriod } from '@sentinel/shared'
import { PERIOD_LABELS, formatPct } from '../../../lib/format'
import type { StateKind } from '../../../lib/states'
import { HistoryStrip } from './history-strip'
import { StatusIndicator } from './status-indicator'

/**
 * One check on the public status grid: name, uptime for the period, state with its since
 * line, a compact strip. The whole card links to the check's page. `row` is the list view.
 */
export function StatusCard({
  href,
  name,
  uptime,
  period,
  kind,
  since,
  buckets,
  row,
}: {
  href: string
  name: string
  uptime: number | null | undefined
  period: StatusPeriod
  kind: StateKind
  since: string
  /** null while loading */
  buckets: StatusBucket[] | null
  row?: boolean
}) {
  const metric = uptime === undefined ? '…' : formatPct(uptime)
  if (row) {
    return (
      <Link className="sn-card sn-card--row" href={href}>
        <div className="sn-row" style={{ justifyContent: 'space-between', gap: '4px 12px' }}>
          <span className="sn-card__name" title={name}>
            {name}
          </span>
          <span className="sn-card__state">
            <StatusIndicator kind={kind} />
            <span className="sn-num">
              {metric} in {PERIOD_LABELS[period]}
            </span>
          </span>
        </div>
        <HistoryStrip buckets={buckets} period={period} tooltips={false} href={href} />
      </Link>
    )
  }
  return (
    <Link className="sn-card" href={href}>
      <span className="sn-card__name" title={name}>
        {name}
      </span>
      <div className="sn-card__metric">
        {metric}
        <small>{PERIOD_LABELS[period]}</small>
      </div>
      <div className="sn-card__state">
        <StatusIndicator kind={kind} />
        <span>{since}</span>
      </div>
      <HistoryStrip buckets={buckets} period={period} compact cells={30} tooltips={false} href={href} />
    </Link>
  )
}
