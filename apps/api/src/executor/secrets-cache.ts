import { listAllDecryptedSecrets } from '../db/queries/secrets.js'

let cache: Readonly<Record<string, string>> = {}

/**
 * Loads and decrypts all secrets into an in-memory snapshot. Called once at startup
 * and again after every create/rotate/delete so `run.ts` never touches the DB or
 * does crypto on the per-test-run hot path (500 tests/min through a 5-connection pool).
 */
export async function warmSecretsCache(): Promise<void> {
  const rows = await listAllDecryptedSecrets()
  cache = Object.freeze(Object.fromEntries(rows.map((r) => [r.name, r.value])))
}

export function getSecretsSnapshot(): Readonly<Record<string, string>> {
  return cache
}
