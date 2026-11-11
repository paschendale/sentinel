import { TOKEN_COOKIE } from './auth-cookie'

/** Base URL of the API as the browser reaches it. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/** Read token from document.cookie (client-side only). */
export function getToken(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${TOKEN_COOKIE}=`))
  return match ? (match.split('=')[1] ?? null) : null
}

/** Authorization header for client-side fetch calls. */
export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Store the session token after sign-in. */
export function setToken(token: string): void {
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `${TOKEN_COOKIE}=${token}; expires=${expires}; path=/; SameSite=Strict`
}

/**
 * fetch() wrapper that sends the session token and signs the operator out on 401.
 * Callers should not pass Authorization themselves.
 */
export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  })
  if (res.status === 401) window.location.replace('/admin/signout')
  return res
}

export type ApiCall<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

/**
 * Call the API as the signed-in operator and read the JSON answer. Errors come back as
 * `{ ok: false, error }` with the API's own message (`{ error }` body) when it sent one.
 */
export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<ApiCall<T>> {
  let res: Response
  try {
    res = await fetchWithAuth(`${API_URL}${path}`, {
      method: init?.method ?? 'GET',
      ...(init?.body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
    })
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the API. Check that it is running, then retry.' }
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!res.ok) {
    const msg = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `The API answered ${res.status}.`
    return { ok: false, status: res.status, error: msg }
  }
  return { ok: true, data: body as T }
}
