'use client'

import { useState } from 'react'
import type { TestStatus } from '@sentinel/shared'

const TRUNCATE = 120

export interface RunRow {
  id: string
  status: TestStatus
  duration_ms: number
  error_message: string | null
  finished_at: string
  assertions: Array<{ name: string; passed: boolean; message: string | null }>
}

function StatusCell({ status }: { status: TestStatus }) {
  if (status === 'success') {
    return (
      <span className="flex items-center gap-1.5 text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden />
        pass
      </span>
    )
  }
  if (status === 'warn') {
    return (
      <span className="flex items-center gap-1.5 text-yellow-400">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" aria-hidden />
        warn
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-red-400">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" aria-hidden />
      {status === 'timeout' ? 'timeout' : 'fail'}
    </span>
  )
}

function RunRowView({ run }: { run: RunRow }) {
  const [expanded, setExpanded] = useState(false)
  const msg = run.error_message
  const needsTruncate = msg != null && msg.length > TRUNCATE
  const shown =
    !msg ? null : expanded || !needsTruncate ? msg : `${msg.slice(0, TRUNCATE)}…`

  return (
    <tr className="border-b border-zinc-800/80 last:border-0 hover:bg-zinc-900/40 transition-opacity duration-150 align-top">
      <td className="py-3 pr-6 text-zinc-500 text-xs tabular-nums whitespace-nowrap">
        <time dateTime={run.finished_at}>
          {new Date(run.finished_at).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'medium',
          })}
        </time>
      </td>
      <td className="py-3 pr-6">
        <StatusCell status={run.status} />
      </td>
      <td className="py-3 pr-6 text-zinc-400 text-xs tabular-nums text-right whitespace-nowrap">
        {run.duration_ms}ms
      </td>
      <td className="py-3 min-w-0">
        <div className="text-sm min-w-0">
          {msg ? (
            <>
              <p className={`text-zinc-400 break-words ${expanded ? '' : 'line-clamp-2'}`}>{shown}</p>
              {needsTruncate && (
                <button
                  type="button"
                  onClick={() => setExpanded(e => !e)}
                  className="text-zinc-500 text-xs mt-1 hover:text-zinc-300 transition-opacity duration-150"
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </>
          ) : run.assertions.length === 0 ? (
            <span className="text-zinc-600">—</span>
          ) : null}
          {run.assertions.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {run.assertions.map((a, i) => (
                <li key={i} className={`flex items-start gap-1.5 text-xs ${a.passed ? 'text-emerald-500' : 'text-red-400'}`}>
                  <span className="shrink-0">{a.passed ? '✓' : '✗'}</span>
                  <span>
                    {a.name}
                    {!a.passed && a.message ? ` — ${a.message}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </td>
    </tr>
  )
}

export function RunHistory({ runs }: { runs: RunRow[] }) {
  if (runs.length === 0) {
    return <p className="text-zinc-500 text-sm mt-4">No runs yet.</p>
  }

  return (
    <div className="mt-6 w-full overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm border-collapse text-left">
        <thead>
          <tr className="text-zinc-600 text-xs tracking-widest uppercase">
            <th className="pb-4 pr-6 font-normal">Time</th>
            <th className="pb-4 pr-6 font-normal">Status</th>
            <th className="pb-4 pr-6 font-normal text-right">Duration</th>
            <th className="pb-4 font-normal">Details</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(run => (
            <RunRowView key={run.id} run={run} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
