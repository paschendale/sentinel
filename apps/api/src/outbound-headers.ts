import { SENTINEL_INSTANCE } from './config.js'

const PRODUCT_URL = 'https://github.com/paschendale/sentinel'

export const SENTINEL_USER_AGENT = SENTINEL_INSTANCE
  ? `Sentinel (+${PRODUCT_URL}; instance=${SENTINEL_INSTANCE})`
  : `Sentinel (+${PRODUCT_URL})`

/** Headers that identify Sentinel (and, if configured, which instance) on every outbound request. */
const SENTINEL_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'user-agent': SENTINEL_USER_AGENT,
  ...(SENTINEL_INSTANCE ? { 'x-sentinel-instance': SENTINEL_INSTANCE } : {}),
})

/**
 * Returns `headers` with Sentinel's identifying headers added. A header the caller already set
 * (compared case-insensitively) wins, so test code can still override User-Agent.
 */
export function withSentinelHeaders(headers?: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  const present = new Set(Object.keys(headers ?? {}).map((name) => name.toLowerCase()))
  for (const [name, value] of Object.entries(SENTINEL_HEADERS)) {
    if (!present.has(name)) result[name] = value
  }
  return { ...result, ...headers }
}
