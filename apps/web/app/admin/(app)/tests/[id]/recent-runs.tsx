'use client'

import { useState } from 'react'
import type { TestStatus } from '@sentinel/shared'
import { dateTime, formatMs, plural } from '../../../../../lib/format'
import { runKind, runLabel } from '../../../../../lib/states'
import { Button, StatusIndicator } from '../../../../_components/ui'

export interface RunRow {
  id: string
  status: TestStatus
  duration_ms: number
  error_message: string | null
  finished_at: string
  assertions: Array<{ name: string; passed: boolean; message: string | null }>
}

const CLIP = 140
/** Runs listed before "Show all". */
const SHOWN = 10

function Detail({ run }: { run: RunRow }) {
  const [open, setOpen] = useState(false)
  const failed = run.assertions.filter((a) => !a.passed)
  const msg = run.error_message
  if (!msg && run.assertions.length === 0) return <span className="sn-subtle">—</span>
  const long = !!msg && msg.length > CLIP
  return (
    <div style={{ minWidth: 0 }}>
      {msg && (
        <span className={run.status === 'success' ? undefined : run.status === 'warn' ? 'sn-tone--degraded' : 'sn-tone--outage'} style={{ overflowWrap: 'anywhere' }}>
          {long && !open ? `${msg.slice(0, CLIP)}…` : msg}
        </span>
      )}
      {!msg && failed.length === 0 && <span>{plural(run.assertions.length, 'assertion')} passed</span>}
      {failed.length > 0 && (
        <span className="sn-table__sub">
          {failed.map((a) => `${a.name}${a.message ? `: ${a.message}` : ''}`).join(' · ')}
        </span>
      )}
      {long && (
        <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} style={{ marginLeft: -10 }}>
          {open ? 'Show less' : 'Show more'}
        </Button>
      )}
    </div>
  )
}

/** A test's latest runs with the run-result words: Passed, Warned, Failed, Timed out. */
export function RecentRuns({ runs: all }: { runs: RunRow[] }) {
  const [more, setMore] = useState(false)
  const runs = more ? all : all.slice(0, SHOWN)
  if (all.length === 0) return <p className="sn-emptyline">No runs yet. Use Run now, or wait for the next scheduled run.</p>
  return (
    <div className="sn-table-wrap">
      <table className="sn-table" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th style={{ width: 170 }}>Finished</th>
            <th style={{ width: 120 }}>Result</th>
            <th className="sn-num" style={{ width: 100 }}>
              Duration
            </th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td suppressHydrationWarning>
                <time dateTime={r.finished_at}>{dateTime(r.finished_at)}</time>
              </td>
              <td>
                <StatusIndicator kind={runKind(r.status)} label={runLabel(r.status)} />
              </td>
              <td className="sn-num">{formatMs(r.duration_ms)}</td>
              <td>
                <Detail run={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {all.length > SHOWN && (
        <Button variant="secondary" size="sm" className="sn-show" onClick={() => setMore((m) => !m)}>
          {more ? 'Show fewer' : `Show all ${all.length}`}
        </Button>
      )}
    </div>
  )
}
