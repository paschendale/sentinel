import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOKEN_COOKIE } from './auth-cookie'

/** Base URL of the API as the web server reaches it. */
export function apiBase(): string {
  return process.env.API_URL ?? 'http://localhost:3001'
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string }

interface Options {
  /** Send the signed-in operator's token. On 401 the operator is signed out. */
  auth?: boolean
  /** Seconds the response may be reused (public pages). Signed-in requests are never cached. */
  revalidate?: number
}

/**
 * GET a JSON resource from the API. A failed request is returned as `ok: false` so the page
 * can show the outage callout instead of an empty list.
 */
export async function apiGet<T>(path: string, opts: Options = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {}
  if (opts.auth) {
    const token = (await cookies()).get(TOKEN_COOKIE)?.value
    if (token) headers.Authorization = `Bearer ${token}`
  }
  let res: Response
  try {
    res = await fetch(`${apiBase()}${path}`, {
      headers,
      ...(opts.auth || opts.revalidate === undefined ? { cache: 'no-store' as const } : { next: { revalidate: opts.revalidate } }),
    })
  } catch {
    return { ok: false, status: 0, error: 'The API could not be reached.' }
  }
  if (res.status === 401 && opts.auth) redirect('/admin/signout')
  if (!res.ok) {
    let error = `The API answered ${res.status}.`
    try {
      const body = (await res.json()) as { error?: unknown }
      if (typeof body.error === 'string') error = body.error
    } catch {
      // not JSON
    }
    return { ok: false, status: res.status, error }
  }
  return { ok: true, data: (await res.json()) as T }
}
