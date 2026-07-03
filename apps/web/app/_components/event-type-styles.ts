import type { NotificationEventType } from '@sentinel/shared'

export const EVENT_TYPES: Array<{ type: NotificationEventType; label: string; title: string }> = [
  { type: 'fail', label: 'F', title: 'Failure' },
  { type: 'warning', label: 'W', title: 'Warning' },
  { type: 'recovery', label: 'R', title: 'Recovery' },
]

export const EVENT_TYPE_ACTIVE_STYLES: Record<NotificationEventType, string> = {
  fail: 'bg-red-950 text-red-400',
  warning: 'bg-yellow-950 text-yellow-400',
  recovery: 'bg-emerald-950 text-emerald-400',
}

/** Default event-type set for a newly-added channel assignment — every type active. */
export const ALL_EVENT_TYPES: NotificationEventType[] = EVENT_TYPES.map(e => e.type)
