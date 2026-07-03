import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import type { EffectiveChannelAssignment, Incident, Test } from '@sentinel/shared'
import { DeleteTestButton } from '../_components/delete-test-button'
import { RunLatencyChartLoader } from '../_components/run-latency-chart-loader'
import { RunHistory, type RunRow } from '../_components/run-history'
import { RunNowPanel } from '../_components/run-now-panel'
import { IncidentTimeline } from '../_components/incident-timeline'
import { NotificationScheme } from '../_components/notification-scheme'
import { serverAuthHeaders } from '../../../lib/auth-server'

export const dynamic = 'force-dynamic'

function formatCooldown(ms: number): string {
  if (ms === 0) return 'disabled'
  const h = ms / 3_600_000
  return h >= 1 ? `${h}h` : `${ms / 60_000}m`
}

async function getTest(id: string): Promise<Test | null> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/tests/${id}`, { cache: 'no-store', headers: serverAuthHeaders(await cookies()) })
    if (!res.ok) return null
    return res.json() as Promise<Test>
  } catch {
    return null
  }
}

async function getIncidents(id: string): Promise<Incident[]> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/tests/${id}/incidents`, { cache: 'no-store', headers: serverAuthHeaders(await cookies()) })
    if (!res.ok) return []
    return res.json() as Promise<Incident[]>
  } catch {
    return []
  }
}

async function getEffectiveChannels(id: string): Promise<EffectiveChannelAssignment[]> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/tests/${id}/channels/effective`, { cache: 'no-store', headers: serverAuthHeaders(await cookies()) })
    if (!res.ok) return []
    return res.json() as Promise<EffectiveChannelAssignment[]>
  } catch {
    return []
  }
}

async function getRuns(id: string): Promise<RunRow[]> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/tests/${id}/runs`, { cache: 'no-store', headers: serverAuthHeaders(await cookies()) })
    if (!res.ok) return []
    const rows = (await res.json()) as Array<{
      id: string
      status: RunRow['status']
      duration_ms: number
      error_message: string | null
      finished_at: string
      assertions: Array<{ name: string; passed: boolean; message: string | null }>
    }>
    return rows.map(r => ({
      id: r.id,
      status: r.status,
      duration_ms: r.duration_ms,
      error_message: r.error_message,
      finished_at:
        typeof r.finished_at === 'string'
          ? r.finished_at
          : new Date(r.finished_at as unknown as string).toISOString(),
      assertions: r.assertions,
    }))
  } catch {
    return []
  }
}

export default async function TestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const test = await getTest(id)
  if (!test) notFound()
  const [runs, incidents, channels] = await Promise.all([getRuns(id), getIncidents(id), getEffectiveChannels(id)])

  return (
    <main className="min-h-screen w-full bg-zinc-950 px-8 py-10">
      <Link
        href="/"
        className="text-zinc-500 text-xs hover:text-zinc-300 transition-opacity duration-150 block mb-8"
      >
        ← back
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-6">
        <h1 className="text-zinc-100 text-lg tracking-tight">{test.name}</h1>
        <div className="flex items-center gap-6">
          <Link
            href={`/tests/${id}/edit`}
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-opacity duration-150"
          >
            Edit
          </Link>
          <DeleteTestButton testId={id} testName={test.name} />
          <RunNowPanel testId={id} />
        </div>
      </header>

      <section className="mt-8">
        <h2 className="text-zinc-500 text-xs tracking-widest uppercase font-normal mb-3">Configuration</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-4">
          <div>
            <p className="text-zinc-500 text-xs tracking-wider uppercase mb-1">Interval</p>
            <p className="text-zinc-300 text-sm">{test.schedule_ms / 1000}s</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs tracking-wider uppercase mb-1">Timeout</p>
            <p className="text-zinc-300 text-sm">{test.timeout_ms / 1000}s</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs tracking-wider uppercase mb-1">Retries</p>
            <p className="text-zinc-300 text-sm">{test.retries}</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs tracking-wider uppercase mb-1">Failure threshold</p>
            <p className="text-zinc-300 text-sm">{test.failure_threshold}</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs tracking-wider uppercase mb-1">Alert cooldown</p>
            <p className="text-zinc-300 text-sm">{formatCooldown(test.cooldown_ms)}</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs tracking-wider uppercase mb-1">Uses browser</p>
            <p className="text-zinc-300 text-sm">{test.uses_browser ? 'Yes' : 'No'}</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs tracking-wider uppercase mb-1">Status</p>
            <p className={`text-sm ${test.enabled ? 'text-emerald-400' : 'text-zinc-500'}`}>
              {test.enabled ? 'enabled' : 'disabled'}
            </p>
          </div>
          {test.tags.length > 0 && (
            <div>
              <p className="text-zinc-500 text-xs tracking-wider uppercase mb-1">Tags</p>
              <div className="flex flex-wrap gap-1">
                {test.tags.map(tag => (
                  <span key={tag} className="text-xs px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded-sm">{tag}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-zinc-500 text-xs tracking-widest uppercase font-normal mb-3">Notifications</h2>
        <NotificationScheme channels={channels} testId={id} />
      </section>

      <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 lg:items-start">
        <section className="min-w-0">
          <h2 className="text-zinc-500 text-xs tracking-widest uppercase font-normal mb-3">Code</h2>
          <pre
            className="text-sm text-zinc-400 bg-zinc-900/50 border border-zinc-800/80 rounded-lg p-4 max-h-72 overflow-auto leading-relaxed whitespace-pre-wrap break-words"
            style={{ fontFamily: 'Consolas, ui-monospace, monospace' }}
          >
            {test.code}
          </pre>
        </section>

        <section className="min-w-0">
          <h2 className="text-zinc-500 text-xs tracking-widest uppercase font-normal mb-3">
            Latency <span className="text-zinc-600 normal-case tracking-normal font-normal">(oldest → newest)</span>
          </h2>
          <RunLatencyChartLoader runs={runs} />
        </section>
      </div>

      <section className="mt-14 w-full max-w-none">
        <h2 className="text-zinc-500 text-xs tracking-widest uppercase font-normal">Recent runs</h2>
        <RunHistory runs={runs} />
      </section>

      <section className="mt-14 w-full max-w-none">
        <h2 className="text-zinc-500 text-xs tracking-widest uppercase font-normal">Incidents</h2>
        <IncidentTimeline incidents={incidents} />
      </section>
    </main>
  )
}
