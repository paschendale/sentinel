/**
 * NTRIP sourcetable support for `ctx.ntrip.sourcetable()` (RBMC branch).
 *
 * An NTRIP caster answers `GET /` with a text "sourcetable": one line per
 * entry, fields separated by `;`. `STR` lines describe mountpoints (streams),
 * `CAS` lines other casters, `NET` lines networks. The table ends with the
 * `ENDSOURCETABLE` sentinel.
 *
 * IBGE's caster only speaks proper HTTP when `Ntrip-Version: Ntrip/2.0` is
 * sent — without it the status line is `SOURCETABLE 200 OK`, which undici
 * rejects — so the headers are hard-wired here rather than left to test code.
 */

export interface NtripStreamRow {
  /** e.g. `VICO0` — station code + suffix (`0` = RTCM 3.2/3.3 MSM, `1` = legacy RTCM 3.0 on RBMC-IP). */
  mountpoint: string
  /** Human identifier, usually the city. */
  identifier: string
  /** e.g. `RTCM 3.2`. */
  format: string
  /** Message list, e.g. `1006(1),1008(10),1077(1)`. */
  formatDetails: string
  /** e.g. `GPS+GLO+GAL+BDS`. */
  navSystem: string
  /** e.g. `RBMC-IP`. */
  network: string
  country: string
  lat: number | null
  lon: number | null
  /** Receiver / generator, e.g. `TRIMBLE NETR9`. */
  generator: string
}

export const NTRIP_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Ntrip-Version': 'Ntrip/2.0',
  'User-Agent': 'NTRIP Sentinel/1.0',
})

export const ENDSOURCETABLE = 'ENDSOURCETABLE'

export class NtripRequestError extends Error {
  readonly code: 'NTRIP_FETCH_ERROR' | 'NTRIP_PARSE_ERROR'
  readonly url: string

  constructor(code: NtripRequestError['code'], message: string, url: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NtripRequestError'
    this.code = code
    this.url = url
  }
}

function numOrNull(s: string | undefined): number | null {
  if (s === undefined || s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Parses the raw sourcetable text into `STR` rows. Throws `NTRIP_PARSE_ERROR` if the sentinel is missing. */
export function parseSourcetable(text: string, url = ''): NtripStreamRow[] {
  if (!text.includes(ENDSOURCETABLE)) {
    throw new NtripRequestError(
      'NTRIP_PARSE_ERROR',
      `Sourcetable from ${url || 'caster'} is missing the ENDSOURCETABLE sentinel (got ${text.length} bytes)`,
      url
    )
  }
  const rows: NtripStreamRow[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('STR;')) continue
    const f = line.split(';')
    rows.push({
      mountpoint: f[1] ?? '',
      identifier: f[2] ?? '',
      format: f[3] ?? '',
      formatDetails: f[4] ?? '',
      navSystem: f[6] ?? '',
      network: f[7] ?? '',
      country: f[8] ?? '',
      lat: numOrNull(f[9]),
      lon: numOrNull(f[10]),
      generator: f[13] ?? '',
    })
  }
  return rows
}

export interface SourcetableResult {
  rows: ReadonlyArray<NtripStreamRow>
  /** True when served from the cache without a network round-trip. */
  cached: boolean
  fetchedAt: number
}

export interface SourcetableCache {
  get(url: string): Promise<SourcetableResult>
  /** Warm rows or `null`; never fetches. */
  peek(url: string): ReadonlyArray<NtripStreamRow> | null
  clear(): void
}

interface CacheOptions {
  ttlMs: number
  fetchText: (url: string) => Promise<string>
  now?: () => number
}

/**
 * Shared, per-URL cache so every station test (157 of them on the RBMC
 * instance) reuses one download per TTL window. Concurrent callers share a
 * single in-flight promise; failures are never cached.
 */
export function createSourcetableCache(opts: CacheOptions): SourcetableCache {
  const now = opts.now ?? (() => Date.now())
  const entries = new Map<string, { rows: ReadonlyArray<NtripStreamRow>; fetchedAt: number }>()
  const inFlight = new Map<string, Promise<SourcetableResult>>()

  function freezeRows(rows: NtripStreamRow[]): ReadonlyArray<NtripStreamRow> {
    for (const r of rows) Object.freeze(r)
    return Object.freeze(rows)
  }

  return {
    async get(url) {
      const entry = entries.get(url)
      if (entry && now() - entry.fetchedAt < opts.ttlMs) {
        return { rows: entry.rows, cached: true, fetchedAt: entry.fetchedAt }
      }
      const pending = inFlight.get(url)
      if (pending) return pending

      const p = (async (): Promise<SourcetableResult> => {
        try {
          const text = await opts.fetchText(url)
          const rows = freezeRows(parseSourcetable(text, url))
          const fetchedAt = now()
          entries.set(url, { rows, fetchedAt })
          return { rows, cached: false, fetchedAt }
        } finally {
          inFlight.delete(url)
        }
      })()
      inFlight.set(url, p)
      return p
    },
    peek(url) {
      const entry = entries.get(url)
      if (!entry || now() - entry.fetchedAt >= opts.ttlMs) return null
      return entry.rows
    },
    clear() {
      entries.clear()
      inFlight.clear()
    },
  }
}
