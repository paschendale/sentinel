import type { Metadata } from 'next'
import type { AssignedChannel, NotificationChannel, TestSummary } from '@sentinel/shared'
import { apiGet } from '../../../../lib/api-server'
import { ApiErrorCallout } from '../../../_components/ui'
import { NotificationsView } from './notifications-view'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Notifications' }

export default async function NotificationsPage() {
  const [channels, tags, tests] = await Promise.all([
    apiGet<NotificationChannel[]>('/channels', { auth: true }),
    apiGet<string[]>('/tags', { auth: true }),
    apiGet<TestSummary[]>('/dashboard', { auth: true }),
  ])
  const tagList = tags.ok ? tags.data : []
  const routes = await Promise.all(
    tagList.map(async (tag) => {
      const r = await apiGet<AssignedChannel[]>(`/tags/${encodeURIComponent(tag)}/channels`, { auth: true })
      return [tag, r.ok ? r.data : []] as const
    }),
  )
  const counts: Record<string, number> = {}
  if (tests.ok) for (const t of tests.data) for (const tag of t.tags) counts[tag] = (counts[tag] ?? 0) + 1
  if (!channels.ok) return <NotificationsView channels={[]} routes={{}} tags={tagList} counts={counts} failed={<ApiErrorCallout what="channel list" error={channels.error} />} />
  return <NotificationsView channels={channels.data} routes={Object.fromEntries(routes)} tags={tagList} counts={counts} />
}
