import Link from 'next/link'
import type { EffectiveChannelAssignment } from '@sentinel/shared'
import { ChannelTypeBadge } from '../../_components/channel-type-badge'
import { EventTypeBadges } from '../../_components/event-type-badges'

function describeSource(source: EffectiveChannelAssignment['sources'][number]): string {
  return source.scope_type === 'test' ? 'direct' : `tag: ${source.scope_value}`
}

interface Props {
  channels: EffectiveChannelAssignment[]
  testId: string
}

export function NotificationScheme({ channels, testId }: Props) {
  if (channels.length === 0) {
    return (
      <p className="text-zinc-600 text-sm">
        No notifications configured.{' '}
        <Link
          href={`/tests/${testId}/edit`}
          className="text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition-colors"
        >
          Add one
        </Link>
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {channels.map(ch => (
        <div
          key={ch.id}
          className="flex flex-wrap items-center gap-2 text-sm px-3 py-2 bg-zinc-900/50 border border-zinc-800/80 rounded-lg"
        >
          <ChannelTypeBadge type={ch.type} />
          <span className={ch.enabled ? 'text-zinc-300' : 'text-zinc-600'}>{ch.name}</span>
          {!ch.enabled && <span className="text-zinc-600 text-xs">(disabled)</span>}
          <EventTypeBadges value={ch.event_types} />
          <span className="text-zinc-600 text-xs ml-auto">
            {ch.sources.map(describeSource).join(', ')}
          </span>
        </div>
      ))}
    </div>
  )
}
