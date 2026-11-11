/** Cookie that carries the operator's session token. */
export const TOKEN_COOKIE = 'sentinel_token'

/** Seconds since epoch at which a JWT expires, read without verifying it; null if unreadable. */
export function tokenExpiry(token: string): number | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown }
    return typeof json.exp === 'number' ? json.exp : null
  } catch {
    return null
  }
}

/** A token that is present and not past its expiry. The API still verifies it. */
export function isLiveToken(token: string | undefined): token is string {
  if (!token) return false
  const exp = tokenExpiry(token)
  return exp === null || exp * 1000 > Date.now()
}
