import { nanoid } from 'nanoid'
import type { IncidentThread, IncidentThreadState } from '@sentinel/shared'
import { pool } from '../pool.js'

const COLUMNS =
  'id, test_id, channel_id, state, provider_root_id, provider_thread_id, opened_at, closed_at, last_update_at, last_update_message, update_count'

/** Open incident threads (closed_at IS NULL) for the given tests, any channel. */
export async function getOpenThreads(testIds: string[]): Promise<IncidentThread[]> {
  if (testIds.length === 0) return []
  const { rows } = await pool.query<IncidentThread>(
    `SELECT ${COLUMNS} FROM notification_threads WHERE test_id = ANY($1) AND closed_at IS NULL`,
    [testIds],
  )
  return rows
}

export async function openThread(input: {
  test_id: string
  channel_id: string
  state: IncidentThreadState
  provider_root_id: string
  provider_thread_id: string
  message: string | null
}): Promise<IncidentThread> {
  const { rows } = await pool.query<IncidentThread>(
    `INSERT INTO notification_threads
       (id, test_id, channel_id, state, provider_root_id, provider_thread_id, last_update_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [nanoid(), input.test_id, input.channel_id, input.state, input.provider_root_id, input.provider_thread_id, input.message],
  )
  return rows[0]!
}

export async function recordThreadUpdate(id: string, state: IncidentThreadState, message: string | null): Promise<void> {
  await pool.query(
    `UPDATE notification_threads
        SET state = $2, last_update_message = $3, last_update_at = NOW(), update_count = update_count + 1
      WHERE id = $1`,
    [id, state, message],
  )
}

export async function closeThread(id: string): Promise<void> {
  await pool.query('UPDATE notification_threads SET closed_at = NOW() WHERE id = $1 AND closed_at IS NULL', [id])
}

/** Prunes closed threads older than the cutoff. Open threads are never touched. */
export async function pruneClosedThreads(cutoff: Date): Promise<number> {
  const { rowCount } = await pool.query(
    'DELETE FROM notification_threads WHERE closed_at IS NOT NULL AND closed_at < $1',
    [cutoff],
  )
  return rowCount ?? 0
}
