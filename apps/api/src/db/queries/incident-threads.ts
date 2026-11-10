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

/**
 * Open threads whose test has been Operational for a while: the recovery that should have
 * closed them failed (provider error, restart). `settledMs` keeps the reconciler out of the
 * way of a recovery that is being delivered right now.
 */
export async function getThreadsToReconcile(settledMs: number): Promise<Array<IncidentThread & { test_name: string; last_duration_ms: number | null }>> {
  const { rows } = await pool.query<IncidentThread & { test_name: string; last_duration_ms: number | null }>(
    `SELECT ${COLUMNS.split(', ').map((c) => `nt.${c}`).join(', ')}, t.name AS test_name,
            (SELECT r.duration_ms FROM test_runs r WHERE r.test_id = nt.test_id ORDER BY r.started_at DESC LIMIT 1) AS last_duration_ms
       FROM notification_threads nt
       JOIN tests t ON t.id = nt.test_id
       JOIN test_state ts ON ts.test_id = nt.test_id
      WHERE nt.closed_at IS NULL
        AND ts.public_status = 'up'
        AND COALESCE(ts.problem_ended_at, ts.last_run_at) < NOW() - make_interval(secs => $1::double precision / 1000)
      LIMIT 50`,
    [settledMs],
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
