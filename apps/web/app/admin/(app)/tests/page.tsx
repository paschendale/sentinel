import type { Metadata } from 'next'
import type { IncidentListItem, TestSummary } from '@sentinel/shared'
import { apiGet } from '../../../../lib/api-server'
import { ApiErrorCallout } from '../../../_components/ui'
import { Dashboard } from './dashboard'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Tests' }

export default async function TestsPage() {
  const [tests, incidents] = await Promise.all([
    apiGet<TestSummary[]>('/dashboard', { auth: true }),
    apiGet<IncidentListItem[]>('/incidents?state=open', { auth: true }),
  ])
  if (!tests.ok) return <ApiErrorCallout what="dashboard" error={tests.error} />
  return <Dashboard tests={tests.data} openIncidents={incidents.ok ? incidents.data : []} fetchedAt={new Date().toISOString()} />
}
