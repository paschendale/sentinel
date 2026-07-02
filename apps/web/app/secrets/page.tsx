import Link from 'next/link'
import { cookies } from 'next/headers'
import type { Secret } from '@sentinel/shared'
import { serverAuthHeaders } from '../../lib/auth-server'
import { SecretManager } from './_components/secret-manager'

export const dynamic = 'force-dynamic'

async function getSecrets(hdrs: Record<string, string>): Promise<Secret[]> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/secrets`, { cache: 'no-store', headers: hdrs })
    if (!res.ok) return []
    return res.json() as Promise<Secret[]>
  } catch {
    return []
  }
}

async function getEncryptionEnabled(hdrs: Record<string, string>): Promise<boolean> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/secrets/status`, { cache: 'no-store', headers: hdrs })
    if (!res.ok) return false
    const data = await res.json() as { encryptionEnabled: boolean }
    return data.encryptionEnabled
  } catch {
    return false
  }
}

export default async function SecretsPage() {
  const hdrs = serverAuthHeaders(await cookies())
  const [secrets, encryptionEnabled] = await Promise.all([
    getSecrets(hdrs),
    getEncryptionEnabled(hdrs),
  ])

  return (
    <main className="min-h-screen bg-zinc-950 px-8 py-12">
      <div className="flex items-center justify-between mb-8">
        <Link href="/" className="text-zinc-100 text-lg hover:text-white transition-colors">sentinel</Link>
        <div className="flex items-center gap-6">
          <Link href="/status" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">status page</Link>
          <Link href="/notifications" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">notifications</Link>
          <Link href="/secrets" className="text-zinc-300 text-sm">secrets</Link>
          <Link href="/tests/new" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">+ new test</Link>
        </div>
      </div>

      <div className="max-w-2xl mx-auto mt-8">
        <SecretManager secrets={secrets} encryptionEnabled={encryptionEnabled} />
      </div>
    </main>
  )
}
