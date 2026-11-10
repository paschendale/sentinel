import type { ReactNode } from 'react'
import type { NotificationChannelType, NotificationEventType } from '@sentinel/shared'
import { EVENT_KIND, EVENT_ORDER, eventLabel } from '../../../lib/states'
import { Mark, StatusIndicator } from './status-indicator'
import { Tag } from './tag'

/** Channel types as a person reads them; shown as a neutral Tag, never coloured. */
export const CHANNEL_TYPE_LABELS: Record<NotificationChannelType, string> = {
  slack: 'slack webhook',
  discord: 'discord webhook',
  webhook: 'webhook',
  email: 'email',
  slack_bot: 'slack bot',
  discord_bot: 'discord bot',
}

/** The three events spelled out with their shapes. Each toggle saves on its own. */
export function EventToggles({ value, onToggle, disabled }: { value: NotificationEventType[]; onToggle: (e: NotificationEventType) => void; disabled?: boolean }) {
  return (
    <span className="sn-evts" role="group" aria-label="Events">
      {EVENT_ORDER.map((e) => (
        <button key={e} type="button" className="sn-evt" aria-pressed={value.includes(e)} disabled={disabled} onClick={() => onToggle(e)}>
          <Mark kind={EVENT_KIND[e]} />
          {eventLabel(e)}
        </button>
      ))}
    </span>
  )
}

/** Read-only: the events a channel receives, as state chips. */
export function EventChips({ value }: { value: NotificationEventType[] }) {
  return (
    <span className="sn-evts">
      {EVENT_ORDER.filter((e) => value.includes(e)).map((e) => (
        <StatusIndicator key={e} kind={EVENT_KIND[e]} label={eventLabel(e)} chip />
      ))}
    </span>
  )
}

/** One channel row: name, its type as a neutral tag, then whatever the context adds. */
export function ChannelRow({ name, type, children, href }: { name: string; type: NotificationChannelType; children?: ReactNode; href?: string }) {
  return (
    <div className="sn-channel">
      {href ? (
        <a className="sn-channel__name" href={href}>
          {name}
        </a>
      ) : (
        <span className="sn-channel__name">{name}</span>
      )}
      <Tag tag={CHANNEL_TYPE_LABELS[type]} />
      {children}
    </div>
  )
}
