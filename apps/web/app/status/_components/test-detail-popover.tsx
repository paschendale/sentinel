'use client'

import type { PublicStatusOutcome, PublicStatusTest, StatusBucket, StatusPeriod } from '@sentinel/shared'
import { StatusBucketsView } from './status-buckets-view'
import { TagList } from '../../_components/tag-list'

interface Props {
  test: PublicStatusTest
  buckets: StatusBucket[]
  loading: boolean
  period: StatusPeriod
  /** Renders a close (×) button when provided — used where the panel is click-locked open. */
  onClose?: () => void
}

export function computeUptimePct(buckets: StatusBucket[]): number | null {
  let s = 0, f = 0
  for (const b of buckets) { s += b.success_count; f += b.failure_count }
  if (s + f === 0) return null
  return Math.round((100 * s) / (s + f))
}

export function statusLabelClass(status: PublicStatusOutcome): string {
  if (status === 'up')       return 'text-emerald-400/90'
  if (status === 'degraded') return 'text-yellow-400/90'
  if (status === 'down')     return 'text-red-400/90'
  return 'text-zinc-500'
}

/**
 * The single info panel used everywhere a test's live status is shown "at a glance": the
 * grid-view hover popover and the RBMC map's hover/click panel both render this — Sentinel
 * stays the one source of truth for what a test's status means, the map just points at a station.
 */
export function TestDetailPopover({ test, buckets, loading, period, onClose }: Props) {
  const uptimePct = buckets.length > 0 ? computeUptimePct(buckets) : null
  const detailHref = `/status/tests/${test.id}`

  return (
    <div className="bg-zinc-900 border border-zinc-700/80 rounded-lg p-4 shadow-xl space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-zinc-100 text-sm font-medium leading-snug">{test.name}</p>
          {test.tags.length > 0 && (
            <TagList
              tags={test.tags}
              size="2xs"
              interactive={false}
              className="mt-1.5"
              renderTag={tag => (
                <a
                  key={tag}
                  href={`/status/${encodeURIComponent(tag)}`}
                  className="text-[10px] px-1.5 py-0.5 bg-zinc-800 text-zinc-500 hover:text-zinc-300 rounded-sm transition-colors"
                >
                  {tag}
                </a>
              )}
            />
          )}
          {!test.enabled && <p className="text-zinc-600 text-[10px] mt-1">monitoring disabled</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs uppercase tracking-wide ${statusLabelClass(test.current_status)}`}>
            {test.current_status}
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-600 hover:text-zinc-300 transition-colors"
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Uptime */}
      <p className="text-2xl font-semibold tabular-nums text-zinc-100 tracking-tight leading-none">
        {loading ? <span className="text-zinc-600">…</span> : uptimePct !== null ? `${uptimePct}%` : <span className="text-zinc-600">—</span>}
        <span className="text-xs font-normal text-zinc-500 ml-1.5">{period} uptime</span>
      </p>

      {/* Full histogram with tooltips (hover a bar for the last check's assertions, e.g. which mountpoints are online) */}
      {loading ? (
        <div className="flex gap-px w-full">
          {Array.from({ length: 30 }).map((_, i) => (
            <div key={i} className="flex-1 min-w-0 aspect-square rounded-[1px] bg-zinc-800/60 animate-pulse" />
          ))}
        </div>
      ) : (
        <StatusBucketsView testId={test.id} buckets={buckets} period={period} />
      )}

      {/* Link */}
      <a
        href={detailHref}
        className="block text-right text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        view details →
      </a>
    </div>
  )
}
