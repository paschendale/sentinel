import { nanoid } from 'nanoid'
import type { NotificationChannel, NotificationChannelType } from '@sentinel/shared'
import { pool } from '../pool.js'
import { decryptSecret, encryptSecret } from '../../crypto/secret-cipher.js'
import { logger } from '../../logger.js'

/**
 * Every column an API response may carry. `bot_token_blob` is deliberately absent: the
 * token is write-only, like a secret, and only `has_bot_token` says whether one is stored.
 */
export const CHANNEL_COLUMNS =
  'id, name, type, webhook_url, email_to, channel_ref, enabled, (bot_token_blob IS NOT NULL) AS has_bot_token'

export interface ChannelWriteInput {
  name: string
  type: NotificationChannelType
  webhook_url?: string | null | undefined
  email_to?: string[] | null | undefined
  channel_ref?: string | null | undefined
  bot_token?: string | undefined
  enabled?: boolean | undefined
}

export async function listChannels(): Promise<NotificationChannel[]> {
  const { rows } = await pool.query<NotificationChannel>(
    `SELECT ${CHANNEL_COLUMNS} FROM notification_channels ORDER BY name ASC`,
  )
  return rows
}

export async function getChannel(id: string): Promise<NotificationChannel | null> {
  const { rows } = await pool.query<NotificationChannel>(
    `SELECT ${CHANNEL_COLUMNS} FROM notification_channels WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function createChannel(input: ChannelWriteInput): Promise<NotificationChannel> {
  const id = nanoid()
  const { rows } = await pool.query<NotificationChannel>(
    `INSERT INTO notification_channels (id, name, type, webhook_url, email_to, channel_ref, bot_token_blob, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${CHANNEL_COLUMNS}`,
    [
      id,
      input.name,
      input.type,
      input.webhook_url ?? null,
      input.email_to ?? null,
      input.channel_ref ?? null,
      input.bot_token === undefined ? null : encryptSecret(input.bot_token),
      input.enabled ?? true,
    ],
  )
  return rows[0]!
}

/** Fields of a partial update; `undefined` means "leave as is". */
export type ChannelPatch = { [K in keyof ChannelWriteInput]?: ChannelWriteInput[K] | undefined }

/** Partial update. `bot_token` replaces the stored token; omitting it keeps the current one. */
export async function updateChannel(id: string, patch: ChannelPatch): Promise<NotificationChannel | null> {
  const sets: string[] = []
  const values: unknown[] = [id]
  const push = (column: string, value: unknown): void => {
    values.push(value)
    sets.push(`${column} = $${values.length}`)
  }
  if (patch.name !== undefined) push('name', patch.name)
  if (patch.type !== undefined) push('type', patch.type)
  if (patch.webhook_url !== undefined) push('webhook_url', patch.webhook_url)
  if (patch.email_to !== undefined) push('email_to', patch.email_to)
  if (patch.channel_ref !== undefined) push('channel_ref', patch.channel_ref)
  if (patch.bot_token !== undefined) push('bot_token_blob', encryptSecret(patch.bot_token))
  if (patch.enabled !== undefined) push('enabled', patch.enabled)
  if (sets.length === 0) return getChannel(id)
  const { rows } = await pool.query<NotificationChannel>(
    `UPDATE notification_channels SET ${sets.join(', ')} WHERE id = $1 RETURNING ${CHANNEL_COLUMNS}`,
    values,
  )
  return rows[0] ?? null
}

export async function deleteChannel(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM notification_channels WHERE id = $1', [id])
  return !!rowCount
}

/** Decrypts a stored bot token blob. Returns null (and logs) when it cannot be decrypted. */
export function decryptBotToken(blob: Buffer | null, channelId: string): string | null {
  if (blob === null) return null
  try {
    return decryptSecret(blob)
  } catch (err) {
    logger.error(
      { event: 'channel.token_decrypt_failed', channel_id: channelId, err },
      `failed to decrypt the bot token of channel ${channelId}; its notifications will fail until the token is set again`,
    )
    return null
  }
}

/** The delivery view of a channel: everything the notifier needs, token decrypted. */
export interface DeliverableChannel {
  id: string
  type: NotificationChannelType
  webhook_url: string | null
  email_to: string[] | null
  channel_ref: string | null
  bot_token: string | null
}

export async function getDeliverableChannel(id: string): Promise<DeliverableChannel | null> {
  const { rows } = await pool.query<{
    id: string
    type: NotificationChannelType
    webhook_url: string | null
    email_to: string[] | null
    channel_ref: string | null
    bot_token_blob: Buffer | null
  }>(
    'SELECT id, type, webhook_url, email_to, channel_ref, bot_token_blob FROM notification_channels WHERE id = $1',
    [id],
  )
  const row = rows[0]
  if (row === undefined) return null
  return {
    id: row.id,
    type: row.type,
    webhook_url: row.webhook_url,
    email_to: row.email_to,
    channel_ref: row.channel_ref,
    bot_token: decryptBotToken(row.bot_token_blob, row.id),
  }
}
