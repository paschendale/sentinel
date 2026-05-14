'use client'

import dynamic from 'next/dynamic'
import type { StatusBucket, StatusPeriod } from '@sentinel/shared'

const StatusLatencyChart = dynamic(
  () => import('./status-latency-chart').then(m => ({ default: m.StatusLatencyChart })),
  {
    ssr: false,
    loading: () => (
      <div className="h-48 w-full border border-zinc-800/80 rounded-lg bg-zinc-900/30" aria-hidden />
    ),
  }
)

export function StatusLatencyChartLoader({ buckets, period }: { buckets: StatusBucket[]; period: StatusPeriod }) {
  return <StatusLatencyChart buckets={buckets} period={period} />
}
