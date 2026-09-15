import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { RbmcMapCollection } from '@sentinel/shared'
import { serverAuthHeaders } from '../lib/auth-server'
import { SentinelLogo } from './_components/sentinel-logo'
import { RbmcMapLoader } from './status/_components/rbmc-map-loader'

export const dynamic = 'force-dynamic'

const API_URL = process.env.API_URL ?? 'http://localhost:3001'
const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/** The map itself is public data; this call only proves the cookie is a valid session. */
async function isAuthenticated(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: 'no-store' })
    if (!res.ok) return true // API down: let the page render and fail visibly instead of bouncing to /login
    const probe = await fetch(`${API_URL}/dashboard`, { cache: 'no-store', headers: serverAuthHeaders(await cookies()) })
    return probe.status !== 401
  } catch {
    return true
  }
}

async function getRbmcMap(): Promise<RbmcMapCollection> {
  const empty: RbmcMapCollection = { type: 'FeatureCollection', features: [] }
  try {
    const res = await fetch(`${API_URL}/status/rbmc/map`, { cache: 'no-store' })
    if (!res.ok) return empty
    const fc = (await res.json()) as RbmcMapCollection
    return fc.type === 'FeatureCollection' ? fc : empty
  } catch {
    return empty
  }
}

export default async function HomePage() {
  if (!(await isAuthenticated())) redirect('/login')
  const map = await getRbmcMap()

  return (
    <main className="min-h-screen bg-zinc-950 px-8 py-12">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2.5">
          <SentinelLogo className="h-7 text-zinc-100" />
          <span className="text-zinc-100 text-lg">sentinel</span>
          <span className="text-zinc-600 text-sm ml-2">RBMC</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/tests" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">tests</Link>
          <Link href="/status" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">status page</Link>
          <Link href="/notifications" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">notifications</Link>
          <Link href="/secrets" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">secrets</Link>
          <Link href="/tokens" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">mcp</Link>
          <Link href="/tests/new" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">+ new test</Link>
        </div>
      </div>

      {map.features.length === 0 ? (
        <p className="text-zinc-500 text-center mt-24">
          No RBMC stations yet — the shapefile sync has not run or found nothing.{' '}
          <Link href="/tests" className="text-zinc-300 hover:text-white transition-colors">View tests →</Link>
        </p>
      ) : (
        <RbmcMapLoader
          initial={map}
          refreshUrl={`${PUBLIC_API_URL}/status/rbmc/map`}
          linkBase="/tests"
          className="h-[calc(100vh-11rem)] min-h-[480px]"
        />
      )}
    </main>
  )
}
