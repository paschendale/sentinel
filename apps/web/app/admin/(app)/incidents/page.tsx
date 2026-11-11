import type { Metadata } from 'next'
import type { IncidentListItem } from '@sentinel/shared'
import { apiGet } from '../../../../lib/api-server'
import { ApiErrorCallout, PageHeader, SectionHeader } from '../../../_components/ui'
import { IncidentTable } from './incident-table'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Incidents' }

const MONTH = 30 * 24 * 3_600_000

export default async function IncidentsPage() {
  const res = await apiGet<IncidentListItem[]>('/incidents?state=all', { auth: true })
  const now = Date.now()
  const header = (
    <PageHeader title="Incidents" meta={<span>Sentinel opens an incident when a test reaches Outage. Nothing is public until you publish it.</span>} />
  )
  if (!res.ok) {
    return (
      <>
        {header}
        <ApiErrorCallout what="incident list" error={res.error} />
      </>
    )
  }
  const open = res.data.filter((i) => i.state !== 'resolved').sort((a, b) => b.started_at.localeCompare(a.started_at))
  const done = res.data
    .filter((i) => i.state === 'resolved' && now - Date.parse(i.resolved_at ?? i.updated_at) < MONTH)
    .sort((a, b) => (b.resolved_at ?? '').localeCompare(a.resolved_at ?? ''))
  return (
    <>
      {header}
      <section className="sn-section sn-section--outage">
        <SectionHeader kind="outage" title="Open" count={open.length} description="Newest first." />
        {open.length ? <IncidentTable incidents={open} now={now} /> : <p className="sn-emptyline">No open incidents.</p>}
      </section>
      <section className="sn-section sn-section--recovered">
        <SectionHeader kind="recovered" title="Resolved in the last 30 days" count={done.length} description="Most recent first." />
        {done.length ? <IncidentTable incidents={done} now={now} /> : <p className="sn-emptyline">Nothing resolved in the last 30 days.</p>}
      </section>
    </>
  )
}
