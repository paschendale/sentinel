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
  // Bot channels: lifecycle of an incident thread (phase 'sent' or 'failed').
  | 'thread_opened'
  | 'thread_updated'
  | 'thread_heartbeat'
  | 'thread_closed'
  | 'thread_update_failed'

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

/**
 * The notifier's audit log records decisions that matter, not every evaluation: deliveries
 * (`sent`, `failed`) and alerts that were due but went nowhere (`skipped` with no_channels or
 * no_prior_notification). Rows are queued and written in batches by flushNotificationEvents().
 */
const queue: NotificationEventInsert[] = []
const BATCH_SIZE = 100
const COLUMNS_PER_ROW = 11

export function queueNotificationEvent(input: NotificationEventInsert): void {
  queue.push(input)
}

export function queuedNotificationEventCount(): number {
  return queue.length
}

/** Writes every queued event, in multi-row inserts of up to 100 rows. */
export async function flushNotificationEvents(): Promise<void> {
  while (queue.length > 0) {
    const batch = queue.splice(0, BATCH_SIZE)
    const values: unknown[] = []
    const placeholders = batch.map((e, i) => {
      const b = i * COLUMNS_PER_ROW
      values.push(
        nanoid(),
        e.test_id,
        e.channel_id ?? null,
        e.event,
        e.phase,
        e.reason ?? null,
        e.consecutive_failures,
        e.failure_threshold,
        e.cooldown_ms,
        e.http_status ?? null,
        e.error_message ?? null,
      )
      return `(${Array.from({ length: COLUMNS_PER_ROW }, (_, k) => `$${b + k + 1}`).join(', ')})`
    })
    await pool.query(
      `INSERT INTO notification_events
        (id, test_id, channel_id, event, phase, reason, consecutive_failures,
         failure_threshold, cooldown_ms, http_status, error_message)
       VALUES ${placeholders.join(', ')}`,
      values,
    )
  }
}
