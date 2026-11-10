import type pg from 'pg'
import type { Test } from '@sentinel/shared'
import { pool } from '../pool.js'

export async function getTestById(id: string): Promise<Test | null> {
  const { rows } = await pool.query<Test>('SELECT * FROM tests WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function getTestsByIds(ids: string[], client: pg.PoolClient | pg.Pool = pool): Promise<Test[]> {
  const { rows } = await client.query<Test>('SELECT * FROM tests WHERE id = ANY($1)', [ids])
  return rows
}

export async function setTestsEnabled(client: pg.PoolClient, ids: string[], enabled: boolean): Promise<Test[]> {
  const { rows } = await client.query<Test>(
    'UPDATE tests SET enabled = $2, updated_at = NOW() WHERE id = ANY($1) RETURNING *',
    [ids, enabled],
  )
  return rows
}

/** Adds a (normalized) tag to each test that lacks it; tests that already have it are returned unchanged. */
export async function addTagToTests(client: pg.PoolClient, ids: string[], tag: string): Promise<Test[]> {
  const { rows } = await client.query<Test>(
    `UPDATE tests SET tags = array_append(tags, $2), updated_at = NOW()
      WHERE id = ANY($1) AND NOT ($2 = ANY(tags))
      RETURNING *`,
    [ids, tag],
  )
  return rows
}

export async function removeTagFromTests(client: pg.PoolClient, ids: string[], tag: string): Promise<Test[]> {
  const { rows } = await client.query<Test>(
    `UPDATE tests SET tags = array_remove(tags, $2), updated_at = NOW()
      WHERE id = ANY($1) AND $2 = ANY(tags)
      RETURNING *`,
    [ids, tag],
  )
  return rows
}

/** Deletes the tests and the channel assignments scoped to them. Returns the deleted ids. */
export async function deleteTests(client: pg.PoolClient, ids: string[]): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>('DELETE FROM tests WHERE id = ANY($1) RETURNING id', [ids])
  const deleted = rows.map((r) => r.id)
  if (deleted.length > 0) {
    await client.query(`DELETE FROM channel_assignments WHERE scope_type = 'test' AND scope_value = ANY($1)`, [deleted])
  }
  return deleted
}
