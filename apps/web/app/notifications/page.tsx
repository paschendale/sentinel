import Link from 'next/link'
import { cookies } from 'next/headers'
import type { NotificationChannel, AssignedChannel } from '@sentinel/shared'
import { serverAuthHeaders } from '../../lib/auth-server'
import { ChannelManager } from './_components/channel-manager'
import { TagAssignmentPanel } from './_components/tag-assignment-panel'

export const dynamic = 'force-dynamic'

async function getChannels(hdrs: Record<string, string>): Promise<NotificationChannel[]> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/channels`, { cache: 'no-store', headers: hdrs })
    if (!res.ok) return []
    return res.json() as Promise<NotificationChannel[]>
  } catch {
    return []
  }
}

async function getTags(hdrs: Record<string, string>): Promise<string[]> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/tags`, { cache: 'no-store', headers: hdrs })
    if (!res.ok) return []
    return res.json() as Promise<string[]>
  } catch {
    return []
  }
}

async function getTagAssignments(
  tags: string[],
  hdrs: Record<string, string>,
): Promise<Record<string, AssignedChannel[]>> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  const entries = await Promise.all(
    tags.map(async tag => {
      try {
        const res = await fetch(`${apiUrl}/tags/${encodeURIComponent(tag)}/channels`, {
          cache: 'no-store',
          headers: hdrs,
        })
        const channels: AssignedChannel[] = res.ok ? await res.json() as AssignedChannel[] : []
        return [tag, channels] as const
      } catch {
        return [tag, []] as const
      }
    })
  )
  return Object.fromEntries(entries)
}

export default async function NotificationsPage() {
  const hdrs = serverAuthHeaders(await cookies())
  const [channels, tags] = await Promise.all([getChannels(hdrs), getTags(hdrs)])
  const tagAssignments = await getTagAssignments(tags, hdrs)

  return (
    <main className="min-h-screen bg-zinc-950 px-8 py-12">
      <div className="flex items-center justify-between mb-8">
        <Link href="/" className="text-zinc-100 text-lg hover:text-white transition-colors">sentinel</Link>
        <div className="flex items-center gap-6">
          <Link href="/status" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">status page</Link>
          <Link href="/notifications" className="text-zinc-300 text-sm">notifications</Link>
          <Link href="/secrets" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">secrets</Link>
          <Link href="/tests/new" className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">+ new test</Link>
        </div>
      </div>

      <div className="max-w-2xl mx-auto mt-8">
        <ChannelManager channels={channels} />
        <TagAssignmentPanel
          tags={tags}
          allChannels={channels}
          tagAssignments={tagAssignments}
        />
      </div>
    </main>
  )
}
