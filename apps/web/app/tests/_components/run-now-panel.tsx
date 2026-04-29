'use client'

import { useEffect, useRef, useState } from 'react'
import { getToken } from '../../../lib/auth-client'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface RunResult {
  status: 'success' | 'warn' | 'fail' | 'timeout'
  duration_ms: number
  error_message: string | null
}

interface Props {
  testId: string
}

export function RunNowPanel({ testId }: Props) {
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (consoleOpen) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, consoleOpen])

  useEffect(() => {
    return () => {
      esRef.current?.close()
    }
  }, [])

  function handleRun() {
    if (running) return
    setRunning(true)
    setLogs([])
    setResult(null)
    setError(null)
    setConsoleOpen(true)

    const token = getToken()
    const streamUrl = token
      ? `${API_URL}/tests/${testId}/run/stream?token=${encodeURIComponent(token)}`
      : `${API_URL}/tests/${testId}/run/stream`
    const es = new EventSource(streamUrl)
    esRef.current = es

    es.addEventListener('log', (e) => {
      const data = JSON.parse(e.data) as { message: string }
      setLogs((prev) => [...prev, data.message])
    })

    es.addEventListener('done', (e) => {
      const data = JSON.parse(e.data) as RunResult
      setResult(data)
      es.close()
      esRef.current = null
      setRunning(false)
    })

    es.addEventListener('error', (e) => {
      if ('data' in e) {
        try {
          const data = JSON.parse((e as MessageEvent).data) as { error: string }
          setError(data.error)
        } catch {
          setError('Run failed.')
        }
      } else {
        setError('Connection error. Is the API running?')
      }
      es.close()
      esRef.current = null
      setRunning(false)
    })
  }

  const statusColor =
    result == null ? '' :
    result.status === 'success' ? 'text-emerald-400' :
    result.status === 'warn' ? 'text-yellow-400' :
    'text-red-400'

  return (
    <>
      {/* Inline header controls: button + result badge */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="border border-zinc-700 text-zinc-400 px-3 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:border-zinc-500 hover:text-zinc-200 transition-colors"
        >
          {running ? 'Running…' : 'Run now'}
        </button>

        {result && !running && (
          <button
            type="button"
            onClick={() => setConsoleOpen((o) => !o)}
            className={`text-xs tabular-nums ${statusColor} hover:opacity-70 transition-opacity`}
          >
            {result.status} · {result.duration_ms}ms
          </button>
        )}

        {error && !running && (
          <span className="text-xs text-red-400">{error}</span>
        )}
      </div>

      {/* Floating console — fixed bottom-right, shown while running or when manually opened */}
      {consoleOpen && (
        <div className="fixed bottom-0 right-0 w-[420px] border border-zinc-800 border-b-0 bg-zinc-950 z-50 flex flex-col shadow-2xl">
          {/* Title bar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/80">
            <span className="text-zinc-500 text-xs tracking-wider uppercase">
              {running ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Running
                </span>
              ) : (
                'Console'
              )}
            </span>
            <button
              type="button"
              onClick={() => setConsoleOpen(false)}
              className="text-zinc-600 hover:text-zinc-300 transition-colors text-base leading-none"
            >
              ×
            </button>
          </div>

          {/* Log output */}
          <div
            className="overflow-auto px-4 py-3 min-h-[80px] max-h-56"
            style={{ fontFamily: 'Consolas, ui-monospace, monospace' }}
          >
            {logs.length === 0 && !result && !error && (
              <span className="text-zinc-600 text-xs">Waiting for output…</span>
            )}
            {logs.map((line, i) => (
              <div key={i} className="text-zinc-300 text-xs leading-5">{line}</div>
            ))}
            <div ref={logEndRef} />
          </div>

          {/* Result footer */}
          {(result ?? error) && (
            <div className={`px-4 py-2.5 border-t border-zinc-800 text-xs flex items-center gap-3 ${
              result ? statusColor : 'text-red-400'
            }`}>
              {result && (
                <>
                  <span>{result.status}</span>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-500 tabular-nums">{result.duration_ms}ms</span>
                  {result.error_message && (
                    <>
                      <span className="text-zinc-600">·</span>
                      <span className="text-zinc-400 truncate">{result.error_message}</span>
                    </>
                  )}
                </>
              )}
              {error && <span>{error}</span>}
            </div>
          )}
        </div>
      )}
    </>
  )
}
