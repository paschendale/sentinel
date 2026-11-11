'use client'

import { LatencyChart } from '../../../../_components/ui'
import { useBuckets } from '../../../../../lib/use-status'

export function TestChart({ id }: { id: string }) {
  const data = useBuckets('24h', { testId: id }, 0)
  return <LatencyChart buckets={data === null ? null : (data.get(id) ?? [])} period="24h" />
}
