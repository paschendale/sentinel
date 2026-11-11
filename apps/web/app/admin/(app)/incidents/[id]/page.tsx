import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { IncidentDetail, TestSummary } from '@sentinel/shared'
import { apiGet } from '../../../../../lib/api-server'
import { ApiErrorCallout } from '../../../../_components/ui'
import { IncidentView } from './incident-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const res = await apiGet<IncidentDetail>(`/incidents/${encodeURIComponent((await params).id)}`, { auth: true })
  return { title: res.ok ? res.data.title : 'Incident' }
}

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [res, tests] = await Promise.all([
    apiGet<IncidentDetail>(`/incidents/${encodeURIComponent(id)}`, { auth: true }),
    apiGet<TestSummary[]>('/dashboard', { auth: true }),
  ])
  if (!res.ok && res.status === 404) notFound()
  if (!res.ok) return <ApiErrorCallout what="incident" error={res.error} />
  return <IncidentView incident={res.data} tests={tests.ok ? tests.data : []} fetchedAt={new Date().toISOString()} />
}
