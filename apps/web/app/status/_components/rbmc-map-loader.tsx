'use client'

import dynamic from 'next/dynamic'
import type { PublicStatusTest, RbmcMapCollection, StatusBucket, StatusPeriod } from '@sentinel/shared'

// MapLibre is a large client-only bundle: load it lazily, never on the server (RULES #20 spirit).
const RbmcMap = dynamic(
  () => import('./rbmc-map').then(m => ({ default: m.RbmcMap })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[85vh] min-h-[480px] w-full rounded-lg border border-zinc-800/80 bg-zinc-900/30" aria-hidden />
    ),
  }
)

interface Props {
  initial: RbmcMapCollection
  refreshUrl: string
  className?: string
  /** Drives the same info panel the grid/list views use — see TestDetailPopover. */
  tests: PublicStatusTest[]
  bucketData: Map<string, StatusBucket[]>
  loading: boolean
  period: StatusPeriod
}

export function RbmcMapLoader({ initial, refreshUrl, className, tests, bucketData, loading, period }: Props) {
  return (
    <RbmcMap
      initial={initial}
      refreshUrl={refreshUrl}
      tests={tests}
      bucketData={bucketData}
      loading={loading}
      period={period}
      {...(className ? { className } : {})}
    />
  )
}
