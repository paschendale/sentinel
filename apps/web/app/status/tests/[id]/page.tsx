import { notFound } from 'next/navigation'
import type { PublicStatusTest } from '@sentinel/shared'
import { SentinelLogo } from '../../../_components/sentinel-logo'
import { StatusTestContent } from './_components/status-test-content'

export const revalidate = 300

async function getTest(id: string): Promise<PublicStatusTest | null> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/status/test/${id}`, { next: { revalidate: 300 } })
    if (res.status === 404) return null
    if (!res.ok) return null
    return res.json() as Promise<PublicStatusTest>
  } catch {
    return null
  }
}

export default async function PublicTestPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const test = await getTest(id)
  if (!test) notFound()

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-12">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <SentinelLogo className="h-7 text-zinc-100" />
            <span className="text-zinc-100 text-lg">sentinel</span>
          </div>
          <a href="/status" className="text-zinc-500 text-xs hover:text-zinc-300 transition-colors">
            ← all tests
          </a>
        </div>
        <StatusTestContent test={test} />
      </div>
    </main>
  )
}
