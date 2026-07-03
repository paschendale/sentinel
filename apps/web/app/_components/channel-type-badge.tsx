import type { NotificationChannelType } from '@sentinel/shared'

const TYPE_BADGE_STYLES: Record<NotificationChannelType, string> = {
  discord: 'bg-indigo-950 text-indigo-400',
  slack: 'bg-emerald-950 text-emerald-400',
  webhook: 'bg-zinc-800 text-zinc-400',
  email: 'bg-amber-950 text-amber-400',
}

export function ChannelTypeBadge({ type }: { type: NotificationChannelType }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-sm font-mono shrink-0 ${TYPE_BADGE_STYLES[type]}`}>
      {type}
    </span>
  )
}
