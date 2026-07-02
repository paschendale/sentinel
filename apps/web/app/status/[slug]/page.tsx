import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { PublicStatusTest } from '@sentinel/shared'
import { StatusPageContent } from '../_components/status-page-content'
import { SentinelLogo } from '../../_components/sentinel-logo'

export const revalidate = 300

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const tag = decodeURIComponent(slug)
  return {
    title: tag,
    description: `Live status and uptime for tests tagged "${tag}".`,
  }
}

async function getTagStatus(tag: string): Promise<PublicStatusTest[] | null> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/status/tag/${encodeURIComponent(tag)}`, {
      next: { revalidate: 300 },
    })
    if (res.status === 404) return null
    if (!res.ok) return []
    return res.json() as Promise<PublicStatusTest[]>
  } catch {
    return []
  }
}

export default async function TagStatusPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const tag = decodeURIComponent(slug)
  const tests = await getTagStatus(tag)

  if (tests === null) notFound()

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-12 overflow-x-clip">
      <div>
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-2.5">
            <SentinelLogo className="h-7 text-zinc-100" />
            <h1 className="text-zinc-100 text-lg font-medium">{tag} · status</h1>
          </div>
          <a href="/status" className="text-zinc-500 text-xs hover:text-zinc-300 transition-colors">
            all tests →
          </a>
        </div>

        <Suspense fallback={null}>
          <StatusPageContent tests={tests} tag={tag} />
        </Suspense>
      </div>
    </main>
  )
}
