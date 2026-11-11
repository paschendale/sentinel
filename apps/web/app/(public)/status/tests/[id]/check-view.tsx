'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { sinceText } from '@sentinel/shared'
import type { PublicIncident, PublicStatusTest, StatusPeriod } from '@sentinel/shared'
import { PERIOD_LABELS, PUBLIC_PERIODS, bucketsUptime, formatPct, isPeriod } from '../../../../../lib/format'
import { publicKind } from '../../../../../lib/states'
import { HistoryStrip, IncidentBanner, LatencyChart, SegmentedControl, StatusIndicator } from '../../../../_components/ui'
import { useAutoRefresh, useBuckets } from '../../../../../lib/use-status'

/** A public check: its state, uptime and history for the period, response time, its published incidents. */
export function CheckView({ test, incidents, fetchedAt }: { test: PublicStatusTest; incidents: PublicIncident[]; fetchedAt: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const raw = params.get('period')
  const period: StatusPeriod = isPeriod(raw) && raw !== '1h' ? raw : '24h'
  const tick = useAutoRefresh()
  const data = useBuckets(period, { testId: test.id }, tick)
  const buckets = data === null ? null : (data.get(test.id) ?? [])
  const [now, setNow] = useState(() => new Date(fetchedAt))
  useEffect(() => setNow(new Date()), [tick])
  const since = sinceText(test, now)
  const uptime = buckets === null ? undefined : bucketsUptime(buckets)

  return (
    <>
      <div className="sn-row">
        <StatusIndicator kind={publicKind(test)} chip />
        {since.tone !== 'muted' && <span className="sn-muted">{since.text}</span>}
      </div>
      <section>
        <div className="sn-row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="sn-metric">
            {uptime === undefined ? '…' : formatPct(uptime)}
            <small>uptime in {PERIOD_LABELS[period]}</small>
          </div>
          <SegmentedControl
            label="Period"
            options={PUBLIC_PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
            value={period}
            onChange={(p) => {
              const next = new URLSearchParams(params.toString())
              next.set('period', p)
              router.replace(`${pathname}?${next.toString()}`, { scroll: false })
            }}
          />
        </div>
        <HistoryStrip buckets={buckets} period={period} axis label={`Status history, ${PERIOD_LABELS[period]}`} />
      </section>
      <section>
        <h2 className="sn-section__title sn-h">Response time · {PERIOD_LABELS[period]}</h2>
        <LatencyChart buckets={buckets} period={period} />
      </section>
      <section>
        <h2 className="sn-section__title sn-h">Incidents</h2>
        {incidents.length > 0 ? (
          <div className="sn-stack">
            {incidents.map((i) => (
              <IncidentBanner key={i.id} incident={i} now={Date.parse(fetchedAt)} />
            ))}
          </div>
        ) : (
          <p className="sn-emptyline">No incidents were published for this check.</p>
        )}
      </section>
    </>
  )
}
