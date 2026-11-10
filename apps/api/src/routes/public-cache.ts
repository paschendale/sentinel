/**
 * In-process cache for the unauthenticated /status routes. Public pages are refreshed by every
 * visitor every minute; without this each refresh would re-read test_runs. Entries live
 * PUBLIC_CACHE_TTL_MS, concurrent misses for one key share a single load, and the cache holds
 * at most PUBLIC_CACHE_MAX_ENTRIES keys (oldest evicted first).
 */
export const PUBLIC_CACHE_TTL_MS = 30_000
export const PUBLIC_CACHE_MAX_ENTRIES = 500

export interface CachedReply {
  status: number
  body: unknown
}

interface Entry {
  expires: number
  value: Promise<CachedReply>
}

const entries = new Map<string, Entry>()

export async function cachedReply(key: string, load: () => Promise<CachedReply>, now: () => number = Date.now): Promise<CachedReply> {
  const hit = entries.get(key)
  if (hit !== undefined && hit.expires > now()) return hit.value
  if (hit !== undefined) entries.delete(key)

  const value = load()
  entries.set(key, { expires: now() + PUBLIC_CACHE_TTL_MS, value })
  while (entries.size > PUBLIC_CACHE_MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    entries.delete(oldest)
  }
  try {
    return await value
  } catch (err) {
    // A failed load is not cached.
    if (entries.get(key)?.value === value) entries.delete(key)
    throw err
  }
}

export function clearPublicCache(): void {
  entries.clear()
}

export function publicCacheSize(): number {
  return entries.size
}

/** Parses an optional ISO timestamp query parameter; 'invalid' when present but not a date. */
export function parseInstant(raw: string | undefined): Date | null | 'invalid' {
  if (raw === undefined || raw === '') return null
  const t = Date.parse(raw)
  if (Number.isNaN(t)) return 'invalid'
  return new Date(t)
}
