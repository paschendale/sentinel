import type { PublicStatusTest } from '@sentinel/shared'
import { StatusPageContent } from './_components/status-page-content'
import { SentinelLogo } from '../_components/sentinel-logo'

export const revalidate = 300

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

export default async function StatusPage() {
  const tests = await getStatus()

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-12">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-center gap-2.5">
          <SentinelLogo className="h-7 text-zinc-100" />
          <span className="text-zinc-100 text-lg">sentinel</span>
        </div>
        <StatusPageContent tests={tests} />
      </div>
    </main>
  )
}
