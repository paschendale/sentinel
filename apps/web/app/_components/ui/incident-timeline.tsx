import type { IncidentUpdate } from '@sentinel/shared'
import { Markdown } from '../../../lib/markdown'
import { Visibility } from './incident-state'
import { Time } from './time-zone'

/** "user:victor" → "victor", "token:ci" → "ci · mcp", "token:" → "agent · mcp". */
export function authorLabel(author: string): string {
  if (author.startsWith('user:')) return author.slice(5) || 'signed in'
  if (author.startsWith('token:')) {
    const label = author.slice(6)
    return label ? `${label} · mcp` : 'agent · mcp'
  }
  return author
}

/**
 * The incident's record, oldest first. System entries are one mono line; notes are prose with
 * the author and a visibility chip. `publicView` hides authors and chips (the public page only
 * ever receives published notes).
 */
export function IncidentTimeline({ updates, publicView }: { updates: Array<Pick<IncidentUpdate, 'id' | 'created_at' | 'body'> & Partial<Pick<IncidentUpdate, 'kind' | 'author' | 'public'>>>; publicView?: boolean }) {
  const sorted = [...updates].sort((a, b) => a.created_at.localeCompare(b.created_at))
  return (
    <ol className="sn-timeline">
      {sorted.map((u) => (
        <li key={u.id} data-kind={u.kind === 'system' ? 'system' : undefined}>
          <Time iso={u.created_at} />
          <div>
            {u.kind === 'system' ? <p>{u.body}</p> : <div className="sn-prose"><Markdown text={u.body} /></div>}
            {!publicView && u.kind !== 'system' && (
              <div className="sn-timeline__by">
                <span>{authorLabel(u.author ?? '')}</span>
                <Visibility published={!!u.public} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
