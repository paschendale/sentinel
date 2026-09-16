'use client'

import type { PublicStatusOutcome, PublicStatusTest, StatusBucket, StatusPeriod } from '@sentinel/shared'
import { computeUptimePct, statusLabelClass, TestDetailPopover } from './test-detail-popover'

interface Props {
  test: PublicStatusTest
  buckets: StatusBucket[]
  loading: boolean
  period: StatusPeriod
}

function dotClass(status: PublicStatusOutcome): string {
  if (status === 'up')       return 'bg-emerald-400'
  if (status === 'degraded') return 'bg-yellow-400'
  if (status === 'down')     return 'bg-red-400'
  return 'bg-zinc-500'
}

function bucketColor(b: StatusBucket): string {
  if (b.failure_count > 0 && b.success_count === 0) return 'bg-red-500/90'
  if (b.failure_count > 0 && b.success_count > 0)   return 'bg-yellow-500/90'
  if (b.success_count > 0)                           return 'bg-emerald-500/90'
  return 'bg-zinc-700/80'
}

const GRID_BUCKET_COUNT = 30

function sampleBuckets(buckets: StatusBucket[], target: number): StatusBucket[] {
  if (buckets.length <= target) return buckets
  const step = buckets.length / target
  return Array.from({ length: target }, (_, i) => buckets[Math.floor(i * step)]!)
}

export function StatusGridCard({ test, buckets, loading, period }: Props) {
  const uptimePct = buckets.length > 0 ? computeUptimePct(buckets) : null
  const displayBuckets = buckets.length > 0 ? sampleBuckets(buckets, GRID_BUCKET_COUNT) : []
  const detailHref = `/status/tests/${test.id}`

  return (
    <div className={`relative group/card ${!test.enabled ? 'opacity-60' : ''}`}>
      {/* Clickable card */}
      <a
        href={detailHref}
        className="block rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-3 flex flex-col gap-2 min-w-0 hover:border-zinc-700 hover:bg-zinc-900/60 transition-colors"
      >
        {/* Name + status */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`shrink-0 w-2 h-2 rounded-full ${dotClass(test.current_status)}`} />
          <span className="text-sm font-medium text-zinc-100 truncate flex-1 min-w-0">{test.name}</span>
          <span className={`shrink-0 text-[10px] uppercase tracking-wide ${statusLabelClass(test.current_status)}`}>
            {test.current_status}
          </span>
        </div>

        {/* Uptime */}
        <p className="text-xl font-semibold tabular-nums text-zinc-100 tracking-tight leading-none">
          {loading ? (
            <span className="text-zinc-600">…</span>
          ) : uptimePct !== null ? (
            `${uptimePct}%`
          ) : (
            <span className="text-zinc-600">—</span>
          )}
          <span className="text-[10px] font-normal text-zinc-600 ml-1.5">{period}</span>
        </p>

        {/* Mini histogram */}
        {loading ? (
          <div className="flex gap-px w-full h-3.5">
            {Array.from({ length: GRID_BUCKET_COUNT }).map((_, i) => (
              <div key={i} className="flex-1 min-w-0 h-full rounded-[1px] bg-zinc-800/60 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="flex gap-px w-full h-3.5">
            {displayBuckets.length > 0
              ? displayBuckets.map((b, i) => (
                  <div key={i} className={`flex-1 min-w-0 h-full rounded-[1px] ${bucketColor(b)}`} />
                ))
              : Array.from({ length: GRID_BUCKET_COUNT }).map((_, i) => (
                  <div key={i} className="flex-1 min-w-0 h-full rounded-[1px] bg-zinc-700/80" />
                ))
            }
          </div>
        )}
      </a>

      {/* Hover popover — bridges card and popover so hover stays active. Same panel the RBMC map uses. */}
      <div
        className={[
          'absolute top-full left-0 z-50 pt-1.5 w-72',
          'opacity-0 invisible pointer-events-none',
          'group-hover/card:opacity-100 group-hover/card:visible group-hover/card:pointer-events-auto',
          'transition-opacity duration-150',
        ].join(' ')}
      >
        <TestDetailPopover test={test} buckets={buckets} loading={loading} period={period} />
      </div>
    </div>
  )
}
