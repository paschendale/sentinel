import type { Test } from '@sentinel/shared'
import { pool } from '../pool.js'

export async function getTestById(id: string): Promise<Test | null> {
  const { rows } = await pool.query<Test>('SELECT * FROM tests WHERE id = $1', [id])
  return rows[0] ?? null
}
