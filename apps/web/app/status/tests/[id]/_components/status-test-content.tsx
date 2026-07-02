'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { PublicStatusOutcome, PublicStatusTest, StatusBucket, StatusBucketTest, StatusPeriod } from '@sentinel/shared'
import { StatusBucketsView } from '../../../_components/status-buckets-view'
import { StatusLatencyChartLoader } from '../../../_components/status-latency-chart-loader'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const PERIODS: StatusPeriod[] = ['1h', '24h', '7d', '30d']

function isPeriod(v: string | null): v is StatusPeriod {
  return v !== null && (PERIODS as string[]).includes(v)
}

function computeUptimePct(buckets: StatusBucket[]): number | null {
  let s = 0, f = 0
  for (const b of buckets) { s += b.success_count; f += b.failure_count }
  if (s + f === 0) return null
  return Math.round((100 * s) / (s + f))
}

function statusColors(status: PublicStatusOutcome) {
  if (status === 'up')       return { dot: 'bg-emerald-400', text: 'text-emerald-400/90' }
  if (status === 'degraded') return { dot: 'bg-yellow-400',  text: 'text-yellow-400/90' }
  if (status === 'down')     return { dot: 'bg-red-400',     text: 'text-red-400/90' }
  return { dot: 'bg-zinc-500', text: 'text-zinc-500' }
}

function dayColor(outcome: PublicStatusOutcome): string {
  if (outcome === 'up')       return 'bg-emerald-500/90'
  if (outcome === 'degraded') return 'bg-yellow-500/90'
  if (outcome === 'down')     return 'bg-red-500/90'
  return 'bg-zinc-700/80'
}

export function StatusTestContent({ test }: { test: PublicStatusTest }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const period = isPeriod(searchParams.get('period')) ? (searchParams.get('period') as StatusPeriod) : '24h'
  const [buckets, setBuckets] = useState<StatusBucket[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  function setPeriod(p: StatusPeriod) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('period', p)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh()
      setRefreshKey(k => k + 1)
    }, 60_000)
    return () => clearInterval(id)
  }, [router])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ period, testId: test.id })
    fetch(`${API_URL}/status/buckets?${params}`)
      .then(r => r.json() as Promise<StatusBucketTest[]>)
      .then(data => { setBuckets(data[0]?.buckets ?? []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [period, test.id, refreshKey])

  const uptimePct = buckets.length > 0 ? computeUptimePct(buckets) : null
  const colors = statusColors(test.current_status)

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="border-b border-zinc-800 pb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-zinc-100 text-2xl font-semibold tracking-tight truncate">{test.name}</h1>
            {!test.enabled && <p className="text-zinc-500 text-xs mt-1">disabled</p>}
            {test.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {test.tags.map(tag => (
                  <a
                    key={tag}
                    href={`/status/${encodeURIComponent(tag)}`}
                    className="text-xs px-1.5 py-0.5 bg-zinc-800 text-zinc-500 hover:text-zinc-300 rounded-sm transition-colors"
                  >
                    {tag}
                  </a>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
            <span className={`text-sm uppercase tracking-wide ${colors.text}`}>{test.current_status}</span>
          </div>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex gap-2">
        {PERIODS.map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`text-xs px-3 py-1 rounded-sm transition-colors ${
              period === p
                ? 'bg-zinc-100 text-zinc-950'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Uptime */}
      <div>
        <p className="text-5xl font-semibold tabular-nums text-zinc-100 tracking-tight">
          {loading ? <span className="text-zinc-600">…</span> : uptimePct !== null ? `${uptimePct}%` : <span className="text-zinc-600">—</span>}
        </p>
        <p className="text-zinc-500 text-sm mt-1">{period} uptime</p>
      </div>

      {/* Status history */}
      <section>
        <h2 className="text-zinc-500 text-xs tracking-widest uppercase font-normal mb-3">Status history</h2>
        {loading ? (
          <div className="flex gap-px w-full">
            {Array.from({ length: period === '30d' ? 30 : 100 }).map((_, i) => (
              <div key={i} className="flex-1 min-w-0 aspect-square rounded-[1px] bg-zinc-800/60 animate-pulse" />
            ))}
          </div>
        ) : (
          <StatusBucketsView testId={test.id} buckets={buckets} period={period} />
        )}
      </section>

      {/* Latency */}
      <section>
        <h2 className="text-zinc-500 text-xs tracking-widest uppercase font-normal mb-3">Avg response time</h2>
        {loading ? (
          <div className="h-48 border border-zinc-800/80 rounded-lg bg-zinc-900/30 animate-pulse" />
        ) : (
          <StatusLatencyChartLoader buckets={buckets} period={period} />
        )}
      </section>

      {/* 30-day calendar */}
      <section>
        <h2 className="text-zinc-500 text-xs tracking-widest uppercase font-normal mb-3">30-day history</h2>
        <div className="flex gap-px w-full">
          {test.days.map(day => (
            <div
              key={day.date}
              title={day.date}
              className={`flex-1 h-5 rounded-[1px] ${dayColor(day.outcome)}`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-zinc-600 text-[11px]">{test.days[0]?.date}</span>
          <span className="text-zinc-600 text-[11px]">today</span>
        </div>
      </section>
    </div>
  )
}
