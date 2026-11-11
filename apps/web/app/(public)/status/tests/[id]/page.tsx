import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { PublicIncident, PublicStatusTest } from '@sentinel/shared'
import { apiGet } from '../../../../../lib/api-server'
import { PUBLIC_REVALIDATE } from '../../../../../lib/site'
import { ApiErrorCallout, BackLink, PublicHeader } from '../../../../_components/ui'
import { CheckView } from './check-view'

export const dynamic = 'force-dynamic'

async function load(id: string) {
  return apiGet<PublicStatusTest>(`/status/test/${encodeURIComponent(id)}`, { revalidate: PUBLIC_REVALIDATE })
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const res = await load((await params).id)
  return res.ok ? { title: res.data.name, description: `Live uptime of ${res.data.name}.` } : {}
}

export default async function PublicCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [res, incidents] = await Promise.all([load(id), apiGet<PublicIncident[]>('/status/incidents', { revalidate: PUBLIC_REVALIDATE })])
  if (!res.ok && res.status === 404) notFound()
  if (!res.ok) {
    return (
      <>
        <div>
          <BackLink href="/">Status</BackLink>
          <PublicHeader title="Check" />
        </div>
        <ApiErrorCallout what="check" error={res.error} />
      </>
    )
  }
  const test = res.data
  if (!test.enabled) notFound()
  return (
    <>
      <div>
        <BackLink href="/">Status</BackLink>
        <PublicHeader title={test.name} />
      </div>
      <CheckView test={test} incidents={incidents.ok ? incidents.data.filter((i) => i.tests.includes(test.name)) : []} fetchedAt={new Date().toISOString()} />
    </>
  )
}
