import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { INCIDENT_STATE_LABELS, formatDuration, sinceText } from '@sentinel/shared'
import type { EffectiveChannelAssignment, IncidentListItem, PublicStatusTest, Test, TestSummary } from '@sentinel/shared'
import { apiGet } from '../../../../../lib/api-server'
import { formatPct, plural } from '../../../../../lib/format'
import { severityKind, testKind } from '../../../../../lib/states'
import {
  ApiErrorCallout,
  Callout,
  ChannelRow,
  CodeBlock,
  DefinitionGrid,
  EventChips,
  PageHeader,
  StatusIndicator,
  Tag,
} from '../../../../_components/ui'
import { IncidentTable } from '../../incidents/incident-table'
import { RecentRuns, type RunRow } from './recent-runs'
import { TestActions } from './test-actions'
import { TestChart } from './test-chart'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const res = await apiGet<Test>(`/tests/${encodeURIComponent((await params).id)}`, { auth: true })
  return { title: res.ok ? res.data.name : 'Test' }
}

function cooldown(ms: number): string {
  return ms === 0 ? 'Off' : formatDuration(ms)
}

function source(ch: EffectiveChannelAssignment): string {
  return ch.sources.map((s) => (s.scope_type === 'test' ? 'set on this test' : `via tag ${s.scope_value}`)).join(', ')
}

export default async function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const enc = encodeURIComponent(id)
  const testRes = await apiGet<Test>(`/tests/${enc}`, { auth: true })
  if (!testRes.ok && testRes.status === 404) notFound()
  if (!testRes.ok) return <ApiErrorCallout what="test" error={testRes.error} />
  const test = testRes.data

  const [runs, channels, incidents, dashboard, pub] = await Promise.all([
    apiGet<RunRow[]>(`/tests/${enc}/runs`, { auth: true }),
    apiGet<EffectiveChannelAssignment[]>(`/tests/${enc}/channels/effective`, { auth: true }),
    apiGet<IncidentListItem[]>('/incidents?state=all', { auth: true }),
    apiGet<TestSummary[]>('/dashboard', { auth: true }),
    apiGet<PublicStatusTest>(`/status/test/${enc}`),
  ])
  const summary = dashboard.ok ? dashboard.data.find((t) => t.id === id) : undefined
  const now = new Date()
  const kind = summary ? testKind(summary) : test.enabled ? 'unknown' : 'paused'
  const since = summary
    ? sinceText({ ...summary, failing: summary.section === 'warning' && summary.consecutive_failures > 0 ? { count: summary.consecutive_failures, threshold: summary.failure_threshold } : null }, now)
    : null
  const mine = incidents.ok ? incidents.data.filter((i) => i.tests.some((l) => l.test_id === id)) : []
  const open = mine.find((i) => i.state !== 'resolved')

  return (
    <>
      <PageHeader
        back={{ href: '/admin/tests', label: 'Tests' }}
        title={test.name}
        meta={
          <>
            <StatusIndicator kind={kind} chip />
            {since && since.tone !== 'muted' && <span suppressHydrationWarning>{since.text}</span>}
            {test.tags.length > 0 && (
              <span className="sn-tags">
                {test.tags.map((t) => (
                  <Tag key={t} tag={t} href={`/admin/tests?tag=${encodeURIComponent(t)}`} />
                ))}
              </span>
            )}
          </>
        }
        actions={<TestActions id={id} name={test.name} />}
      />
      {/* TestActions renders the Run now output here. */}
      <div id="run-output" style={{ display: 'contents' }} />
      {open && (
        <Callout tone={severityKind(open.severity)} title="Part of an open incident.">
          <a className="sn-link" href={`/admin/incidents/${open.id}`}>
            {open.title}
          </a>{' '}
          · {INCIDENT_STATE_LABELS[open.state]} · {open.published_at ? 'Published' : 'Internal'}
        </Callout>
      )}
      <section>
        <h2 className="sn-section__title sn-h">Configuration</h2>
        <DefinitionGrid
          items={[
            { term: 'Interval', value: formatDuration(test.schedule_ms) },
            { term: 'Timeout', value: formatDuration(test.timeout_ms) },
            { term: 'Retries', value: test.retries === 0 ? 'None' : String(test.retries) },
            { term: 'Failure threshold', value: plural(test.failure_threshold, 'run') },
            { term: 'Alert cooldown', value: cooldown(test.cooldown_ms) },
            { term: 'Schedule', value: test.enabled ? 'Active' : 'Paused' },
            { term: 'Uptime · 30 d', value: pub.ok ? formatPct(pub.data.uptime_pct_30d) : '—' },
          ]}
        />
      </section>
      <section>
        <h2 className="sn-section__title sn-h">Notifications</h2>
        {!channels.ok ? (
          <ApiErrorCallout what="notification list" error={channels.error} />
        ) : channels.data.length === 0 ? (
          <p className="sn-emptyline">
            No channel receives alerts for this test.{' '}
            <a className="sn-link" href="/admin/notifications">
              Set up routing
            </a>
          </p>
        ) : (
          channels.data.map((ch) => (
            <ChannelRow key={ch.id} name={ch.name} type={ch.type}>
              <span className="sn-subtle">
                {source(ch)}
                {ch.enabled ? '' : ' · channel off'}
              </span>
              <EventChips value={ch.event_types} />
            </ChannelRow>
          ))
        )}
      </section>
      <div className="sn-two">
        <section>
          <h2 className="sn-section__title sn-h">Code</h2>
          <CodeBlock code={test.code} />
        </section>
        <section>
          <h2 className="sn-section__title sn-h">Response time · 24 h</h2>
          <TestChart id={id} />
        </section>
      </div>
      <section>
        <h2 className="sn-section__title sn-h">Recent runs</h2>
        {runs.ok ? <RecentRuns runs={runs.data} /> : <ApiErrorCallout what="run history" error={runs.error} />}
      </section>
      <section>
        <h2 className="sn-section__title sn-h">Incidents</h2>
        {!incidents.ok ? (
          <ApiErrorCallout what="incident list" error={incidents.error} />
        ) : mine.length > 0 ? (
          <IncidentTable incidents={mine} now={now.getTime()} />
        ) : (
          <p className="sn-emptyline">No incidents recorded for this test.</p>
        )}
      </section>
    </>
  )
}
