'use client'

import { useEffect, useState } from 'react'
import type { PublicStatusOutcome, PublicStatusTest, StatusBucket, StatusBucketTest, StatusPeriod } from '@sentinel/shared'
import { StatusBucketsView } from './status-buckets-view'
import { StatusGridCard } from './status-grid-card'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const PERIODS: StatusPeriod[] = ['1h', '24h', '7d', '30d']

function computeUptimePct(buckets: StatusBucket[]): number | null {
  let s = 0, f = 0
  for (const b of buckets) { s += b.success_count; f += b.failure_count }
  if (s + f === 0) return null
  return Math.round((100 * s) / (s + f))
}

function CurrentLabel({ status }: { status: PublicStatusOutcome }) {
  if (status === 'down')     return <span className="text-xs tracking-wide text-red-400/90 uppercase">down</span>
  if (status === 'degraded') return <span className="text-xs tracking-wide text-yellow-400/90 uppercase">degraded</span>
  if (status === 'up')       return <span className="text-xs tracking-wide text-emerald-400/90 uppercase">up</span>
  return <span className="text-xs tracking-wide text-zinc-500 uppercase">unknown</span>
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="0" y="0" width="6" height="6" rx="1" />
      <rect x="8" y="0" width="6" height="6" rx="1" />
      <rect x="0" y="8" width="6" height="6" rx="1" />
      <rect x="8" y="8" width="6" height="6" rx="1" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="0" y="1" width="14" height="2" rx="1" />
      <rect x="0" y="6" width="14" height="2" rx="1" />
      <rect x="0" y="11" width="14" height="2" rx="1" />
    </svg>
  )
}

type View = 'grid' | 'list'
const VIEW_KEY = 'sentinel-status-view'

interface Props {
  tests: PublicStatusTest[]
  tag?: string
}

export function StatusPageContent({ tests, tag }: Props) {
  const [period, setPeriod] = useState<StatusPeriod>('24h')
  const [bucketData, setBucketData] = useState<Map<string, StatusBucket[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('grid')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY)
      if (saved === 'list' || saved === 'grid') setView(saved)
    } catch {}
  }, [])

  function switchView(v: View) {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch {}
  }

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ period })
    if (tag) params.set('tag', tag)

    fetch(`${API_URL}/status/buckets?${params}`)
      .then(r => r.json() as Promise<StatusBucketTest[]>)
      .then(data => {
        const m = new Map<string, StatusBucket[]>()
        for (const t of data) m.set(t.id, t.buckets)
        setBucketData(m)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [period, tag])

  if (tests.length === 0) {
    return <p className="text-zinc-500 text-center text-sm">No tests configured.</p>
  }

  const controls = (
    <div className="flex items-center justify-between gap-4">
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
      <div className="flex gap-1">
        <button
          onClick={() => switchView('grid')}
          title="Grid view"
          className={`p-1.5 rounded-sm transition-colors ${
            view === 'grid'
              ? 'bg-zinc-100 text-zinc-950'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
          }`}
        >
          <GridIcon />
        </button>
        <button
          onClick={() => switchView('list')}
          title="List view"
          className={`p-1.5 rounded-sm transition-colors ${
            view === 'list'
              ? 'bg-zinc-100 text-zinc-950'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
          }`}
        >
          <ListIcon />
        </button>
      </div>
    </div>
  )

  if (view === 'grid') {
    return (
      <div className="space-y-4">
        {controls}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {tests.map(test => (
            <StatusGridCard
              key={test.id}
              test={test}
              buckets={bucketData.get(test.id) ?? []}
              loading={loading}
              period={period}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {controls}

      <div className="max-w-2xl space-y-8">
        {tests.map(test => {
          const buckets = bucketData.get(test.id) ?? []
          const uptimePct = buckets.length > 0 ? computeUptimePct(buckets) : null

          return (
            <section
              key={test.id}
              className={`rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-5 py-5 ${!test.enabled ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <a
                    href={`/status/tests/${test.id}`}
                    className="text-zinc-100 font-medium text-base hover:text-zinc-300 transition-colors"
                  >
                    {test.name}
                  </a>
                  {!test.enabled && <p className="text-zinc-600 text-xs mt-1">disabled</p>}
                  {(test.tags ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(test.tags ?? []).map(t => (
                        <a
                          key={t}
                          href={`/status/${encodeURIComponent(t)}`}
                          className="text-xs px-1.5 py-0.5 bg-zinc-800 text-zinc-500 hover:text-zinc-300 rounded-sm transition-colors"
                        >
                          {t}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <CurrentLabel status={test.current_status} />
                  <a
                    href={`/status/tests/${test.id}`}
                    className="text-zinc-600 text-xs hover:text-zinc-400 transition-colors"
                  >
                    →
                  </a>
                </div>
              </div>

              <p className="text-4xl font-semibold tabular-nums text-zinc-100 tracking-tight mb-4">
                {loading ? '…' : uptimePct !== null ? `${uptimePct}%` : '—'}
                <span className="block text-xs font-normal text-zinc-500 mt-1 tracking-normal">
                  {period} uptime
                </span>
              </p>

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
          )
        })}
      </div>
    </div>
  )
}
