'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { TestSummary, StatusBucket, StatusBucketTest, StatusPeriod } from '@sentinel/shared'
import { StatusBucketsView } from '../status/_components/status-buckets-view'
import { TagList } from './tag-list'
import { SINCE_TONE_CLASS, SectionBlock, SectionSummary, groupBySection, sinceText, visibleSections } from './sections'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const PERIODS: StatusPeriod[] = ['1h', '24h', '7d', '30d']

type SortKey = 'name' | 'status' | 'last_run_at' | 'avg_latency_ms'

const STATUS_ORDER: Record<string, number> = { success: 0, warn: 1, fail: 2, timeout: 2 }

/** Sorts inside one section when a column header was clicked; otherwise the section's own order stands. */
function sortTests(tests: TestSummary[], key: SortKey | null, dir: 'asc' | 'desc'): TestSummary[] {
  if (!key) return tests
  const mul = dir === 'asc' ? 1 : -1
  return [...tests].sort((a, b) => {
    if (key === 'name') {
      return mul * a.name.localeCompare(b.name)
    }
    if (key === 'status') {
      const ao = a.last_status != null ? (STATUS_ORDER[a.last_status] ?? 2) : 2
      const bo = b.last_status != null ? (STATUS_ORDER[b.last_status] ?? 2) : 2
      return mul * (ao - bo)
    }
    if (key === 'last_run_at') {
      if (!a.last_run_at && !b.last_run_at) return 0
      if (!a.last_run_at) return 1
      if (!b.last_run_at) return -1
      return mul * (new Date(a.last_run_at).getTime() - new Date(b.last_run_at).getTime())
    }
    if (key === 'avg_latency_ms') {
      if (a.avg_latency_ms == null && b.avg_latency_ms == null) return 0
      if (a.avg_latency_ms == null) return 1
      if (b.avg_latency_ms == null) return -1
      return mul * (a.avg_latency_ms - b.avg_latency_ms)
    }
    return 0
  })
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="text-zinc-700">↕</span>
  return <span className="text-zinc-300">{dir === 'asc' ? '↑' : '↓'}</span>
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return '—'
  const diff = Date.now() - new Date(isoString).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function StatusBadge({ status }: { status: TestSummary['last_status'] }) {
  if (status === 'success') {
    return (
      <span className="flex items-center gap-1.5 text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
        pass
      </span>
    )
  }
  if (status === 'warn') {
    return (
      <span className="flex items-center gap-1.5 text-yellow-400">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
        warn
      </span>
    )
  }
  if (status === 'fail' || status === 'timeout') {
    return (
      <span className="flex items-center gap-1.5 text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
        fail
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-zinc-500">
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 inline-block" />
      unknown
    </span>
  )
}

const COLUMNS: Array<{ key: SortKey | null; label: string; className: string }> = [
  { key: 'name', label: 'Name', className: '' },
  { key: 'status', label: 'Status', className: 'w-24' },
  { key: null, label: 'Since', className: 'w-56' },
  { key: 'last_run_at', label: 'Last Run', className: 'w-24' },
  { key: 'avg_latency_ms', label: 'Avg Response', className: 'w-28' },
  { key: null, label: 'History', className: 'w-64' },
]

interface Props {
  tests: TestSummary[]
  tag?: string
}

export function DashboardTable({ tests, tag }: Props) {
  const [period, setPeriod] = useState<StatusPeriod>('24h')
  const [bucketData, setBucketData] = useState<Map<string, StatusBucket[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [now, setNow] = useState(() => new Date())

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const groups = groupBySection(tests)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

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

  const bucketCount = period === '30d' ? 30 : 100

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionSummary groups={groups} />
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
      </div>

      {visibleSections(groups).map(section => {
        const rows = sortTests(groups[section], sortKey, sortDir)
        return (
          <SectionBlock key={section} section={section} count={rows.length}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] table-fixed text-sm">
                <thead>
                  <tr className="text-zinc-600 text-xs tracking-widest uppercase">
                    {COLUMNS.map(col => (
                      <th key={col.label} className={`text-left pb-3 pt-1 font-normal ${col.className}`}>
                        {col.key ? (
                          <button
                            onClick={() => handleSort(col.key!)}
                            className="flex items-center gap-1 hover:text-zinc-400 transition-colors"
                          >
                            {col.label}
                            <SortIcon active={sortKey === col.key} dir={sortDir} />
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(test => {
                    const buckets = bucketData.get(test.id) ?? []
                    const since = sinceText(
                      {
                        ...test,
                        failing:
                          test.section === 'warning' && test.consecutive_failures > 0
                            ? { count: test.consecutive_failures, threshold: test.failure_threshold }
                            : null,
                      },
                      now,
                    )
                    return (
                      <tr key={test.id} className="hover:bg-zinc-900/50 transition-opacity duration-150 align-middle">
                        <td className="py-3 pr-6">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link href={`/tests/${test.id}`} className="text-zinc-100 hover:text-white transition-colors shrink-0">
                              {test.name}
                            </Link>
                            {!test.enabled && <span className="text-zinc-600 text-xs shrink-0">disabled</span>}
                            <TagList
                              tags={test.tags ?? []}
                              className="min-w-0"
                              renderTag={t => (
                                <Link
                                  key={t}
                                  href={`/?tag=${encodeURIComponent(t)}`}
                                  className="text-xs px-1.5 py-0.5 bg-zinc-800 text-zinc-500 hover:text-zinc-300 rounded-sm transition-colors"
                                >
                                  {t}
                                </Link>
                              )}
                            />
                          </div>
                        </td>
                        <td className="py-3 pr-6">
                          <StatusBadge status={test.last_status} />
                        </td>
                        <td className="py-3 pr-6" suppressHydrationWarning>
                          <span className={`block ${SINCE_TONE_CLASS[since.tone]}`}>{since.text}</span>
                          {since.sub && <span className="block text-xs text-zinc-500">{since.sub}</span>}
                        </td>
                        <td className="py-3 pr-6 text-zinc-400">
                          <time dateTime={test.last_run_at ?? undefined} suppressHydrationWarning>
                            {formatRelativeTime(test.last_run_at)}
                          </time>
                        </td>
                        <td className="py-3 pr-6 text-zinc-400">
                          {test.avg_latency_ms != null ? `${test.avg_latency_ms}ms` : '—'}
                        </td>
                        <td className="py-3 w-64">
                          {loading ? (
                            <div className="flex gap-px w-full">
                              {Array.from({ length: bucketCount }).map((_, i) => (
                                <div key={i} className="flex-1 min-w-0 aspect-square rounded-[1px] bg-zinc-800/60 animate-pulse" />
                              ))}
                            </div>
                          ) : buckets.length > 0 ? (
                            <StatusBucketsView testId={test.id} buckets={buckets} period={period} />
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </SectionBlock>
        )
      })}
    </div>
  )
}
