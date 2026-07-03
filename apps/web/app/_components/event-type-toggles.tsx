'use client'

import type { NotificationEventType } from '@sentinel/shared'
import { EVENT_TYPES, EVENT_TYPE_ACTIVE_STYLES } from './event-type-styles'

interface Props {
  value: NotificationEventType[]
  onChange: (next: NotificationEventType[]) => void
  disabled?: boolean
}

export function EventTypeToggles({ value, onChange, disabled }: Props) {
  function toggle(type: NotificationEventType) {
    const active = value.includes(type)
    if (active && value.length === 1) return // never leave zero event types active
    onChange(active ? value.filter(t => t !== type) : [...value, type])
  }

  return (
    <span className="flex items-center gap-0.5">
      {EVENT_TYPES.map(({ type, label, title }) => {
        const active = value.includes(type)
        return (
          <button
            key={type}
            type="button"
            title={title}
            disabled={disabled}
            onClick={() => toggle(type)}
            className={`text-[10px] leading-none w-4 h-4 flex items-center justify-center rounded-sm font-mono transition-colors disabled:opacity-50 ${
              active ? EVENT_TYPE_ACTIVE_STYLES[type] : 'bg-zinc-800 text-zinc-600 hover:text-zinc-400'
            }`}
          >
            {label}
          </button>
        )
      })}
    </span>
  )
}
