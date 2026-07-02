import { pool } from '../pool.js'
import { encryptSecret, decryptSecret } from '../../crypto/secret-cipher.js'
import { logger } from '../../logger.js'

export interface SecretMetadata {
  id: string
  name: string
  created_at: Date
  updated_at: Date
}

interface SecretRow extends SecretMetadata {
  value_blob: Buffer
}

const METADATA_COLUMNS = 'id, name, created_at, updated_at'

export async function createSecret(id: string, name: string, value: string): Promise<SecretMetadata> {
  const { rows } = await pool.query<SecretMetadata>(
    `INSERT INTO secrets (id, name, value_blob)
     VALUES ($1, $2, $3)
     RETURNING ${METADATA_COLUMNS}`,
    [id, name, encryptSecret(value)],
  )
  return rows[0]!
}

export async function rotateSecretValue(id: string, value: string): Promise<SecretMetadata | null> {
  const { rows } = await pool.query<SecretMetadata>(
    `UPDATE secrets SET value_blob = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING ${METADATA_COLUMNS}`,
    [id, encryptSecret(value)],
  )
  return rows[0] ?? null
}

export async function deleteSecret(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM secrets WHERE id = $1', [id])
  return !!rowCount
}

export async function listSecretsMetadata(): Promise<SecretMetadata[]> {
  const { rows } = await pool.query<SecretMetadata>(
    `SELECT ${METADATA_COLUMNS} FROM secrets ORDER BY name ASC`,
  )
  return rows
}

/**
 * Used only by the executor's in-memory cache warm path — never by a route handler.
 * A single undecryptable secret (e.g. SECRETS_ENCRYPTION_KEY was unset after that
 * secret was encrypted) must not take down the whole process — that secret is
 * dropped from the cache (ctx.secrets.NAME reads as undefined) and logged loudly,
 * while every other secret and the rest of the app keep working.
 */
export async function listAllDecryptedSecrets(): Promise<Array<{ name: string; value: string }>> {
  const { rows } = await pool.query<Pick<SecretRow, 'name' | 'value_blob'>>(
    'SELECT name, value_blob FROM secrets',
  )
  const decrypted: Array<{ name: string; value: string }> = []
  for (const row of rows) {
    try {
      decrypted.push({ name: row.name, value: decryptSecret(row.value_blob) })
    } catch (err) {
      logger.error(
        { event: 'secrets.decrypt_failed', name: row.name, err },
        `failed to decrypt secret "${row.name}" — it will be unavailable via ctx.secrets until rotated`
      )
    }
  }
  return decrypted
}
