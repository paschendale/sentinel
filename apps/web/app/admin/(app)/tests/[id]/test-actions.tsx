'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { API_URL, api, getToken } from '../../../../../lib/auth-client'
import { formatMs } from '../../../../../lib/format'
import { runKind, runLabel } from '../../../../../lib/states'
import type { TestStatus } from '@sentinel/shared'
import { Button, ButtonLink, CodeBlock, ConfirmDialog, StatusIndicator } from '../../../../_components/ui'

interface Result {
  status: TestStatus
  duration_ms: number
  error_message: string | null
}

/** Where the run output panel renders: an empty element under the page header (see page.tsx). */
const RUN_OUTPUT_ID = 'run-output'

/** Edit, Delete (confirmed) and Run now, which streams the run's log into a panel under the header. */
export function TestActions({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [running, setRunning] = useState(false)
  const [panel, setPanel] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const es = useRef<EventSource | null>(null)
  useEffect(() => () => es.current?.close(), [])

  function runNow() {
    if (running) return
    setRunning(true)
    setPanel(true)
    setLogs([])
    setResult(null)
    setError(null)
    const token = getToken()
    const src = new EventSource(`${API_URL}/tests/${encodeURIComponent(id)}/run/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`)
    es.current = src
    src.addEventListener('log', (e) => setLogs((l) => [...l, (JSON.parse((e as MessageEvent).data) as { message: string }).message]))
    src.addEventListener('done', (e) => {
      setResult(JSON.parse((e as MessageEvent).data) as Result)
      src.close()
      setRunning(false)
      router.refresh()
    })
    src.addEventListener('error', (e) => {
      let msg = 'Lost the connection to the API during the run. The result appears in Recent runs once it finishes.'
      if ('data' in e && typeof (e as MessageEvent).data === 'string') {
        try {
          msg = (JSON.parse((e as MessageEvent).data) as { error: string }).error
        } catch {
          // keep the default
        }
      }
      setError(msg)
      src.close()
      setRunning(false)
    })
  }

  return (
    <>
      <ButtonLink variant="ghost" href={`/admin/tests/${id}/edit`}>
        Edit
      </ButtonLink>
      <Button variant="danger" onClick={() => setDeleting(true)}>
        Delete
      </Button>
      <Button variant="primary" onClick={runNow} disabled={running}>
        {running ? 'Running…' : 'Run now'}
      </Button>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this test?"
        confirmLabel="Delete test"
        busyLabel="Deleting…"
        tone="danger"
        onConfirm={async () => {
          const res = await api(`/tests/${encodeURIComponent(id)}`, { method: 'DELETE' })
          if (!res.ok) return `Could not delete the test: ${res.error}`
          router.push('/admin/tests')
          router.refresh()
        }}
      >
        “{name}” is deleted with its run history and uptime figures. Incidents it was part of are kept.
      </ConfirmDialog>
      {panel && typeof document !== 'undefined' && document.getElementById(RUN_OUTPUT_ID) && createPortal(
        <div className="sn-stack">
          <div className="sn-row" style={{ justifyContent: 'space-between' }}>
            <span className="sn-label">{running ? 'Running…' : 'Run output'}</span>
            <Button variant="ghost" size="sm" onClick={() => setPanel(false)} disabled={running}>
              Hide
            </Button>
          </div>
          <CodeBlock wrap>{logs.length ? logs.join('\n') : running ? 'Waiting for output…' : 'No log lines.'}</CodeBlock>
          {result && (
            <div className="sn-row">
              <StatusIndicator kind={runKind(result.status)} label={runLabel(result.status)} chip />
              <span className="sn-muted">{formatMs(result.duration_ms)}</span>
              {result.error_message && <span className="sn-tone--outage" style={{ overflowWrap: 'anywhere' }}>{result.error_message}</span>}
            </div>
          )}
          {error && <span className="sn-field__error">{error}</span>}
        </div>,
        document.getElementById(RUN_OUTPUT_ID)!,
      )}
    </>
  )
}
