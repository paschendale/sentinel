'use client'

import Link from 'next/link'
import { useState } from 'react'
import { sinceText } from '@sentinel/shared'
import type { StatusBucket, StatusPeriod, TestSummary } from '@sentinel/shared'
import { PERIOD_LABELS, formatMs, relativeTime } from '../../../lib/format'
import { testKind } from '../../../lib/states'
import { HistoryStrip } from './history-strip'
import { StatusIndicator } from './status-indicator'
import { TagList } from './tag-list'

type SortKey = 'name' | 'status' | 'last_run_at' | 'avg_latency_ms'
const STATUS_ORDER: Record<string, number> = { success: 0, warn: 1, fail: 2, timeout: 2 }

function sortRows(rows: TestSummary[], key: SortKey | null, dir: 1 | -1): TestSummary[] {
  if (!key) return rows
  const nullsLast = (a: number | null, b: number | null) => (a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : dir * (a - b))
  return [...rows].sort((a, b) => {
    if (key === 'name') return dir * a.name.localeCompare(b.name)
    if (key === 'status') return dir * ((STATUS_ORDER[a.last_status ?? 'fail'] ?? 2) - (STATUS_ORDER[b.last_status ?? 'fail'] ?? 2))
    if (key === 'last_run_at') return nullsLast(a.last_run_at ? Date.parse(a.last_run_at) : null, b.last_run_at ? Date.parse(b.last_run_at) : null)
    return nullsLast(a.avg_latency_ms, b.avg_latency_ms)
  })
}

const TONE: Record<string, string> = { critical: 'outage', warning: 'degraded', recovered: 'operational', muted: '' }

/**
 * The dashboard's table of tests, inside one section. Select feeds the bulk bar; headers sort
 * within the section; the table scrolls sideways in its own wrapper, never the page.
 */
export function TestTable({
  rows,
  buckets,
  period,
  selected,
  onToggle,
  incidentOf,
  tagHref,
  now,
}: {
  rows: TestSummary[]
  /** null while loading */
  buckets: Map<string, StatusBucket[]> | null
  period: StatusPeriod
  selected: Set<string>
  onToggle: (id: string, on: boolean) => void
  /** Open incident a test belongs to, if any. */
  incidentOf: (id: string) => string | undefined
  tagHref: (tag: string) => string
  now: Date
}) {
  const [sort, setSort] = useState<{ key: SortKey | null; dir: 1 | -1 }>({ key: null, dir: 1 })
  const sorted = sortRows(rows, sort.key, sort.dir)
  const head = (key: SortKey, label: string, cls?: string, width?: number) => (
    <th className={cls} style={width ? { width } : undefined} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  )
  return (
    <div className="sn-table-wrap">
      <table className={`sn-table${selected.size > 0 ? ' sn-table--selecting' : ''}`} style={{ minWidth: 1100, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ width: 28 }}>
              <span className="sn-visually-hidden">Select</span>
            </th>
            {head('name', 'Name')}
            {head('status', 'Status', undefined, 120)}
            <th style={{ width: 190 }}>Since</th>
            {head('last_run_at', 'Last run', undefined, 100)}
            {head('avg_latency_ms', 'Avg response', 'sn-num', 120)}
            <th style={{ width: 180 }}>History · {PERIOD_LABELS[period]}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const kind = testKind(t)
            const since = sinceText(
              { ...t, failing: t.section === 'warning' && t.consecutive_failures > 0 ? { count: t.consecutive_failures, threshold: t.failure_threshold } : null },
              now,
            )
            const incident = incidentOf(t.id)
            return (
              <tr key={t.id}>
                <td className="sn-select-cell">
                  <input className="sn-check" type="checkbox" aria-label={`Select ${t.name}`} checked={selected.has(t.id)} onChange={(e) => onToggle(t.id, e.target.checked)} />
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <Link className="sn-table__name" href={`/admin/tests/${t.id}`} style={{ flex: 'none', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>
                      {t.name}
                    </Link>
                    {incident && (
                      <Link className="sn-vis" href={`/admin/incidents/${incident}`} style={{ flex: 'none' }}>
                        incident
                      </Link>
                    )}
                    <TagList tags={t.tags} hrefFor={tagHref} />
                  </div>
                </td>
                <td>
                  <StatusIndicator kind={kind} />
                </td>
                <td suppressHydrationWarning>
                  {since.tone === 'muted' ? (
                    <span className="sn-subtle">{kind === 'paused' ? 'paused' : kind === 'unknown' ? 'no runs yet' : 'no problems in 24 h'}</span>
                  ) : (
                    <>
                      <span className={`sn-tone--${TONE[since.tone]}`}>{since.text}</span>
                      {since.sub && <span className="sn-table__sub">{since.sub}</span>}
                    </>
                  )}
                </td>
                <td suppressHydrationWarning>
                  {t.last_run_at ? <time dateTime={t.last_run_at}>{relativeTime(t.last_run_at, now)}</time> : '—'}
                </td>
                <td className="sn-num">{formatMs(t.avg_latency_ms)}</td>
                <td>
                  <HistoryStrip buckets={buckets === null ? null : (buckets.get(t.id) ?? [])} period={period} compact cells={30} href={`/admin/tests/${t.id}`} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
