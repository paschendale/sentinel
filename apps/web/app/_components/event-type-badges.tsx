import type { NotificationEventType } from '@sentinel/shared'
import { EVENT_TYPES, EVENT_TYPE_ACTIVE_STYLES } from './event-type-styles'

/** Read-only F/W/R display — same visual language as EventTypeToggles, no interactivity. */
export function EventTypeBadges({ value }: { value: NotificationEventType[] }) {
  return (
    <span className="flex items-center gap-0.5">
      {EVENT_TYPES.map(({ type, label, title }) => {
        const active = value.includes(type)
        return (
          <span
            key={type}
            title={title}
            className={`text-[10px] leading-none w-4 h-4 flex items-center justify-center rounded-sm font-mono ${
              active ? EVENT_TYPE_ACTIVE_STYLES[type] : 'bg-zinc-800 text-zinc-600'
            }`}
          >
            {label}
          </span>
        )
      })}
    </span>
  )
}
