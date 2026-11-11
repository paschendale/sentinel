import type { PublicIncident, PublicStatusTest } from '@sentinel/shared'
import { apiGet } from '../../../lib/api-server'
import { PUBLIC_REVALIDATE, statusTitle } from '../../../lib/site'
import { ApiErrorCallout, PublicHeader, TagFilters } from '../../_components/ui'
import { StatusBoard } from './status-board'

/**
 * The public status page: `/`, `/status` and `/status/[tag]`. Fetches on the server; the
 * board fetches history for the chosen period in the browser and refreshes every 60 s.
 */
export async function StatusPage({ tag }: { tag?: string }) {
  const [status, tags, incidents] = await Promise.all([
    apiGet<PublicStatusTest[]>(tag ? `/status/tag/${encodeURIComponent(tag)}` : '/status', { revalidate: PUBLIC_REVALIDATE }),
    apiGet<string[]>('/status/tags', { revalidate: PUBLIC_REVALIDATE }),
    apiGet<PublicIncident[]>(`/status/incidents${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`, { revalidate: PUBLIC_REVALIDATE }),
  ])
  const title = tag ? `${statusTitle()} · ${tag}` : statusTitle()
  const tagList = tags.ok ? tags.data : []

  return (
    <>
      <PublicHeader title={title}>
        <TagFilters tags={tagList} current={tag ?? null} allHref="/" hrefFor={(t) => `/status/${encodeURIComponent(t)}`} external />
      </PublicHeader>
      {status.ok ? (
        <StatusBoard
          tests={status.data.filter((t) => t.enabled)}
          incidents={incidents.ok ? incidents.data : []}
          tag={tag}
          fetchedAt={new Date().toISOString()}
        />
      ) : status.status === 404 ? (
        <p className="sn-emptyline">No checks carry the tag “{tag}”.</p>
      ) : (
        <ApiErrorCallout what="status page" error={status.error} />
      )}
    </>
  )
}
