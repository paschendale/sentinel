import { nanoid } from 'nanoid'
import type { NotificationEventType } from '@sentinel/shared'
import { pool } from '../pool.js'

export type NotificationEventPhase = 'evaluated' | 'skipped' | 'attempted' | 'sent' | 'failed'
export type NotificationEventReason =
  | 'below_threshold'
  | 'cooldown_active'
  | 'no_prior_notification'
  | 'no_channels'
  | 'http_error'
  | 'http_non_2xx'

export interface NotificationEventInsert {
  test_id: string
  channel_id?: string | null
  event: NotificationEventType
  phase: NotificationEventPhase
  reason?: NotificationEventReason | null
  consecutive_failures: number
  failure_threshold: number
  cooldown_ms: number
  http_status?: number | null
  error_message?: string | null
}

export async function insertNotificationEvent(input: NotificationEventInsert): Promise<void> {
  await pool.query(
    `INSERT INTO notification_events
      (id, test_id, channel_id, event, phase, reason, consecutive_failures,
       failure_threshold, cooldown_ms, http_status, error_message)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      nanoid(),
      input.test_id,
      input.channel_id ?? null,
      input.event,
      input.phase,
      input.reason ?? null,
      input.consecutive_failures,
      input.failure_threshold,
      input.cooldown_ms,
      input.http_status ?? null,
      input.error_message ?? null,
    ],
  )
}
