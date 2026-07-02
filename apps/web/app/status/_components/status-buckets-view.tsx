'use client'

import { useRef, useState } from 'react'
import type { PublicStatusEvent, StatusBucket, StatusPeriod, TestStatus } from '@sentinel/shared'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface Props {
  testId: string
  buckets: StatusBucket[]
  period: StatusPeriod
}

function bucketColorClass(b: StatusBucket): string {
  if (b.failure_count > 0 && b.success_count === 0) return 'bg-red-500/90'
  if (b.failure_count > 0 && b.success_count > 0) return 'bg-yellow-500/90'
  if (b.success_count > 0) return 'bg-emerald-500/90'
  return 'bg-zinc-700/80'
}

function formatBucketTime(iso: string, period: StatusPeriod): string {
  const d = new Date(iso)
  if (period === '30d') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  if (period === '7d') {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: period === '1h' ? '2-digit' : undefined })
}

function statusLabel(status: TestStatus): { text: string; className: string } {
  if (status === 'success') return { text: 'pass', className: 'text-emerald-400' }
  if (status === 'warn') return { text: 'warn', className: 'text-yellow-400' }
  if (status === 'timeout') return { text: 'timeout', className: 'text-red-400' }
  return { text: 'fail', className: 'text-red-400' }
}

export function StatusBucketsView({ testId, buckets, period }: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const hovered = hoveredIdx !== null ? (buckets[hoveredIdx] ?? null) : null
  const [lastChecks, setLastChecks] = useState<Record<number, PublicStatusEvent | null>>({})
  const fetchedRef = useRef<Set<number>>(new Set())

  function handleHover(i: number, bucket: StatusBucket) {
    setHoveredIdx(i)
    if (fetchedRef.current.has(i) || bucket.success_count + bucket.failure_count === 0) return
    fetchedRef.current.add(i)
    const params = new URLSearchParams({ after: bucket.bucket_start, before: bucket.bucket_end, limit: '1' })
    fetch(`${API_URL}/status/test/${testId}/events?${params}`)
      .then(r => (r.ok ? (r.json() as Promise<PublicStatusEvent[]>) : []))
      .then(rows => setLastChecks(prev => ({ ...prev, [i]: rows[0] ?? null })))
      .catch(() => setLastChecks(prev => ({ ...prev, [i]: null })))
  }

  const lastCheck = hoveredIdx !== null ? lastChecks[hoveredIdx] : undefined

  return (
    <div className="relative">
      <div
        className="flex gap-px w-full"
        role="img"
        aria-label={`${period} status history for ${testId}`}
      >
        {buckets.map((b, i) => (
          <div
            key={i}
            className={`relative flex-1 min-w-0 aspect-square rounded-[1px] cursor-default ${bucketColorClass(b)}`}
            onMouseEnter={() => handleHover(i, b)}
            onMouseLeave={() => setHoveredIdx(null)}
          />
        ))}
      </div>

      {hovered !== null && hoveredIdx !== null && (
        <div
          className="absolute z-20 bottom-full mb-2 pointer-events-none"
          style={{
            left: `${Math.min(Math.max((hoveredIdx / buckets.length) * 100, 0), 75)}%`,
          }}
        >
          <div className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-200 shadow-lg w-64">
            <div className="text-zinc-400 mb-1 whitespace-nowrap">
              {formatBucketTime(hovered.bucket_start, period)}
              {' – '}
              {formatBucketTime(hovered.bucket_end, period)}
            </div>
            <div className="whitespace-nowrap">{hovered.success_count + hovered.failure_count} runs</div>
            <div className="text-emerald-400 whitespace-nowrap">{hovered.success_count} passed</div>
            <div className="text-red-400 whitespace-nowrap">{hovered.failure_count} failed</div>
            <div className="text-zinc-400 whitespace-nowrap">
              avg {hovered.avg_latency_ms !== null ? `${Math.round(hovered.avg_latency_ms)}ms` : '—'}
            </div>

            {hovered.success_count + hovered.failure_count > 0 && (
              <div className="mt-2 pt-2 border-t border-zinc-700/60">
                <p className="text-zinc-500 mb-1">Last check</p>
                {lastCheck === undefined ? (
                  <p className="text-zinc-600">loading…</p>
                ) : lastCheck === null ? (
                  <p className="text-zinc-600">no details available</p>
                ) : (
                  <>
                    <div className={`flex items-center gap-1.5 ${statusLabel(lastCheck.status).className}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" aria-hidden />
                      {statusLabel(lastCheck.status).text}
                      <span className="text-zinc-500">· {lastCheck.duration_ms}ms</span>
                    </div>
                    {lastCheck.assertions.length > 0 ? (
                      <ul className="mt-1 flex flex-col gap-0.5 max-h-32 overflow-y-auto">
                        {lastCheck.assertions.map((a, ai) => (
                          <li
                            key={ai}
                            className={`flex items-start gap-1.5 ${a.passed ? 'text-emerald-500' : 'text-red-400'}`}
                          >
                            <span className="shrink-0">{a.passed ? '✓' : '✗'}</span>
                            <span className="break-words">
                              {a.name}
                              {!a.passed && a.message ? ` — ${a.message}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : lastCheck.error_message ? (
                      <p className="text-red-400 mt-1 break-words">{lastCheck.error_message}</p>
                    ) : null}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
