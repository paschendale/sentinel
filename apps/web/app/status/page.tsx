import { Suspense } from 'react'
import type { Metadata } from 'next'
import type { PublicStatusTest } from '@sentinel/shared'
import { StatusPageContent } from './_components/status-page-content'
import { TagBrowser } from './_components/tag-browser'
import { SentinelLogo } from '../_components/sentinel-logo'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'Status',
  description: 'Live status and uptime for all tests.',
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
  const [tests, tags] = await Promise.all([getStatus(), getTags()])

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-12 overflow-x-clip">
      <div className="space-y-8">
        <div className="flex items-center gap-2.5">
          <SentinelLogo className="h-7 text-zinc-100" />
          <span className="text-zinc-100 text-lg">sentinel</span>
        </div>
        <TagBrowser tags={tags} />
        <Suspense fallback={null}>
          <StatusPageContent tests={tests} />
        </Suspense>
      </div>
    </main>
  )
}
