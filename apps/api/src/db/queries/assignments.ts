import type { AssignedChannel, NotificationEventType } from '@sentinel/shared'
import { pool } from '../pool.js'

export async function getAssignedChannels(
  scopeType: 'test' | 'tag',
  scopeValue: string,
): Promise<AssignedChannel[]> {
  const { rows } = await pool.query<AssignedChannel>(
    `SELECT nc.id, nc.name, nc.type, nc.webhook_url, nc.email_to, nc.enabled, ca.event_types
     FROM notification_channels nc
     JOIN channel_assignments ca ON ca.channel_id = nc.id
     WHERE ca.scope_type = $1 AND ca.scope_value = $2
     ORDER BY nc.name ASC`,
    [scopeType, scopeValue],
  )
  return rows
}

export async function addAssignment(
  channelId: string,
  scopeType: 'test' | 'tag',
  scopeValue: string,
  eventTypes: NotificationEventType[],
): Promise<void> {
  await pool.query(
    `INSERT INTO channel_assignments (channel_id, scope_type, scope_value, event_types)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (channel_id, scope_type, scope_value)
     DO UPDATE SET event_types = excluded.event_types`,
    [channelId, scopeType, scopeValue, eventTypes],
  )
}

export async function removeAssignment(
  channelId: string,
  scopeType: 'test' | 'tag',
  scopeValue: string,
): Promise<void> {
  await pool.query(
    `DELETE FROM channel_assignments
     WHERE channel_id = $1 AND scope_type = $2 AND scope_value = $3`,
    [channelId, scopeType, scopeValue],
  )
}

export async function getDistinctTags(): Promise<string[]> {
  const { rows } = await pool.query<{ tag: string }>(
    `SELECT DISTINCT unnest(tags) AS tag FROM tests WHERE array_length(tags, 1) > 0 ORDER BY tag ASC`,
  )
  return rows.map(r => r.tag)
}
