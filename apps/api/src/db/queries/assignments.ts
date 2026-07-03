import type { AssignedChannel, EffectiveChannelAssignment, NotificationEventType } from '@sentinel/shared'
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

/**
 * Every channel actually wired to notify a test, merging its direct assignment
 * with any inherited via the test's tags — mirrors the scope-matching the notifier
 * uses at dispatch time (apps/api/src/notifier/dispatch.ts), minus the event filter.
 * A channel assigned via multiple matching rows gets the union of their event_types,
 * since the notifier fires it if ANY matching row includes the event.
 */
export async function getEffectiveChannelsForTest(testId: string): Promise<EffectiveChannelAssignment[]> {
  const { rows } = await pool.query<{
    id: string
    name: string
    type: EffectiveChannelAssignment['type']
    webhook_url: string | null
    email_to: string[] | null
    enabled: boolean
    scope_type: 'test' | 'tag'
    scope_value: string
    event_types: NotificationEventType[]
  }>(
    `SELECT nc.id, nc.name, nc.type, nc.webhook_url, nc.email_to, nc.enabled,
            ca.scope_type, ca.scope_value, ca.event_types
     FROM notification_channels nc
     JOIN tests t ON t.id = $1
     JOIN channel_assignments ca ON ca.channel_id = nc.id
     WHERE (ca.scope_type = 'test' AND ca.scope_value = $1)
        OR (
          ca.scope_type = 'tag'
          AND LOWER(BTRIM(ca.scope_value)) = ANY(
            ARRAY(SELECT LOWER(BTRIM(tag_value)) FROM unnest(t.tags) AS tag_value)
          )
        )
     ORDER BY nc.name ASC`,
    [testId],
  )

  const byChannel = new Map<string, EffectiveChannelAssignment>()
  for (const row of rows) {
    const source = { scope_type: row.scope_type, scope_value: row.scope_value, event_types: row.event_types }
    const existing = byChannel.get(row.id)
    if (existing) {
      existing.sources.push(source)
      existing.event_types = Array.from(new Set([...existing.event_types, ...row.event_types]))
    } else {
      byChannel.set(row.id, {
        id: row.id,
        name: row.name,
        type: row.type,
        webhook_url: row.webhook_url,
        email_to: row.email_to,
        enabled: row.enabled,
        event_types: [...row.event_types],
        sources: [source],
      })
    }
  }
  return Array.from(byChannel.values())
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
