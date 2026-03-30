import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { TestSummary } from '@sentinel/shared'
import { serverAuthHeaders } from '../lib/auth-server'
import { DashboardTable } from './_components/dashboard-table'
import { SentinelLogo } from './_components/sentinel-logo'

export const dynamic = 'force-dynamic'

async function getTests(tag?: string): Promise<TestSummary[] | null> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const url = tag ? `${apiUrl}/dashboard?tag=${encodeURIComponent(tag)}` : `${apiUrl}/dashboard`
    const res = await fetch(url, { cache: 'no-store', headers: serverAuthHeaders(await cookies()) })
    if (res.status === 401) return null
    if (!res.ok) return []
    return res.json() as Promise<TestSummary[]>
  } catch {
    return []
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>
}) {
  const { tag } = await searchParams
  const tests = await getTests(tag)
  if (tests === null) redirect('/login')
  const allTags = Array.from(new Set(tests.flatMap(t => t.tags ?? []))).sort()

  return (
    <main className="min-h-screen bg-zinc-950 px-8 py-12">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2.5">
            <SentinelLogo className="h-7 text-zinc-100" />
            <span className="text-zinc-100 text-lg">sentinel</span>
          </div>
        <div className="flex items-center gap-6">
          <Link href="/status" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">status page</Link>
          <Link href="/channels" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">channels</Link>
          <Link href="/tests/new" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">+ new test</Link>
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <Link
            href="/"
            className={`text-xs px-3 py-1 rounded-sm transition-colors ${!tag ? 'bg-zinc-100 text-zinc-950' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}`}
          >
            all
          </Link>
          {allTags.map(t => (
            <Link
              key={t}
              href={`/?tag=${encodeURIComponent(t)}`}
              className={`text-xs px-3 py-1 rounded-sm transition-colors ${tag === t ? 'bg-emerald-900 text-emerald-300' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}`}
            >
              {t}
            </Link>
          ))}
        </div>
      )}

      {tests.length === 0 ? (
        <p className="text-zinc-500 text-center mt-24">{tag ? `No tests tagged "${tag}".` : 'No tests yet.'}</p>
      ) : (
        <DashboardTable tests={tests} tag={tag} />
      )}
    </main>
  )
}
