import { Suspense } from 'react'
import type { Metadata } from 'next'
import type { PublicStatusTest, RbmcMapCollection } from '@sentinel/shared'
import { StatusPageContent } from './_components/status-page-content'
import { TagBrowser } from './_components/tag-browser'
import { SentinelLogo } from '../_components/sentinel-logo'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'Status',
  description: 'Live status map of IBGE RBMC GNSS stations and uptime for all tests.',
}

async function getStatus(): Promise<PublicStatusTest[]> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/status`, { next: { revalidate: 300 } })
    if (!res.ok) return []
    return res.json() as Promise<PublicStatusTest[]>
  } catch {
    return []
  }
}

async function getRbmcMap(): Promise<RbmcMapCollection | undefined> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/status/rbmc/map`, { next: { revalidate: 300 } })
    if (!res.ok) return undefined
    const fc = (await res.json()) as RbmcMapCollection
    return fc.type === 'FeatureCollection' ? fc : undefined
  } catch {
    return undefined
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

export default async function StatusPage() {
  const [tests, tags, map] = await Promise.all([getStatus(), getTags(), getRbmcMap()])

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-12 overflow-x-clip">
      <div className="space-y-8">
        <div className="flex items-center gap-2.5">
          <SentinelLogo className="h-7 text-zinc-100" />
          <span className="text-zinc-100 text-lg">sentinel</span>
        </div>
        <TagBrowser tags={tags} />
        <Suspense fallback={null}>
          <StatusPageContent tests={tests} {...(map ? { map } : {})} />
        </Suspense>
      </div>
    </main>
  )
}
