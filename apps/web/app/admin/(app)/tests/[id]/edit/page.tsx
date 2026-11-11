import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { Test } from '@sentinel/shared'
import { apiGet } from '../../../../../../lib/api-server'
import { ApiErrorCallout } from '../../../../../_components/ui'
import { TestEditor } from '../../_components/test-editor'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Edit test' }

export default async function EditTestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await apiGet<Test>(`/tests/${encodeURIComponent(id)}`, { auth: true })
  if (!res.ok && res.status === 404) notFound()
  if (!res.ok) return <ApiErrorCallout what="test" error={res.error} />
  return <TestEditor test={res.data} />
}
