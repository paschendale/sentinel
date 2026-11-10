'use client'

import dynamic from 'next/dynamic'
import type { StatusBucket, StatusPeriod } from '@sentinel/shared'

const Impl = dynamic(() => import('./latency-chart-impl'), {
  ssr: false,
  loading: () => <div className="sn-latency__empty" aria-hidden="true" />,
})

/**
 * Response time of one test over the period: a neutral line with an `overlay` area, and a bar
 * under the plot for each Degraded or Outage stretch. `buckets: null` while loading.
 */
export function LatencyChart({ buckets, period }: { buckets: StatusBucket[] | null; period: StatusPeriod }) {
  if (buckets === null) return <div className="sn-latency__empty" aria-hidden="true" />
  return <Impl buckets={buckets} period={period} />
}
