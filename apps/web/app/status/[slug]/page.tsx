import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { PublicStatusTest, RbmcMapCollection } from '@sentinel/shared'
import { StatusPageContent } from '../_components/status-page-content'

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

async function getTags(): Promise<string[]> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/status/tags`, { next: { revalidate: 300 } })
    if (!res.ok) return []
    return res.json() as Promise<string[]>
  } catch {
    return []
  }
}

/** Same aggregated GeoJSON as the main /status map, scoped to this tag via ?tag= (RBMC branch). */
async function getRbmcMap(tag: string): Promise<RbmcMapCollection | undefined> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/status/rbmc/map?tag=${encodeURIComponent(tag)}`, { next: { revalidate: 300 } })
    if (!res.ok) return undefined
    const fc = (await res.json()) as RbmcMapCollection
    return fc.type === 'FeatureCollection' ? fc : undefined
  } catch {
    return undefined
  }
}

export default async function TagStatusPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const tag = decodeURIComponent(slug)
  const [tests, tags, map] = await Promise.all([getTagStatus(tag), getTags(), getRbmcMap(tag)])

  if (tests === null) notFound()

  return (
    <main className="min-h-screen bg-zinc-950 px-4 sm:px-6 py-5 sm:py-8 overflow-x-clip">
      <Suspense fallback={null}>
        <StatusPageContent
          tests={tests}
          tag={tag}
          tags={tags}
          heading={`${tag} · status`}
          backHref="/status"
          {...(map ? { map } : {})}
        />
      </Suspense>
    </main>
  )
}
