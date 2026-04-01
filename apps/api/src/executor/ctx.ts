import { fetch } from 'undici'
import type { RequestInit } from 'undici'
import type { AssertionResult } from '@sentinel/shared'

export interface HttpResponse {
  status: number
  body: string
  headers: Record<string, string>
  json(): unknown
}

export interface HttpOptions {
  headers?: Record<string, string>
  timeout?: number
  redirect?: 'follow' | 'manual' | 'error'
}

export interface TestContext {
  http: {
    get(url: string, options?: HttpOptions): Promise<HttpResponse>
    post(url: string, body: unknown, options?: HttpOptions): Promise<HttpResponse>
  }
  assert: (name: string, value: unknown, message?: string) => void
  log: (message: string) => void
  now: () => Date
}

type AssertionCapture = Omit<AssertionResult, 'id' | 'test_run_id'>

interface CtxBundle {
  ctx: TestContext
  getLogs: () => string[]
  getAssertions: () => AssertionCapture[]
}

export interface HttpCompleteInfo {
  method: string
  url: string
  status: number
  duration_ms: number
}

export interface BuildCtxOptions {
  onLog?: (message: string) => void
  onHttpComplete?: (info: HttpCompleteInfo) => void
}

function truncateUrl(url: string, max = 200): string {
  return url.length > max ? `${url.slice(0, max)}…` : url
}

export class HttpRequestError extends Error {
  readonly code: 'HTTP_FETCH_ERROR' | 'HTTP_REDIRECT_ERROR'
  readonly url: string
  readonly method: string

  constructor(
    code: 'HTTP_FETCH_ERROR' | 'HTTP_REDIRECT_ERROR',
    message: string,
    url: string,
    method: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'HttpRequestError'
    this.code = code
    this.url = url
    this.method = method
  }
}

function isRedirectLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const cause = err.cause
  if (cause instanceof Error) {
    return cause.message.toLowerCase().includes('redirect count exceeded')
  }
  return err.message.toLowerCase().includes('redirect count exceeded')
}

async function doFetch(
  url: string,
  init: RequestInit,
  onHttpComplete?: BuildCtxOptions['onHttpComplete']
): Promise<HttpResponse> {
  const method = init.method ?? 'GET'
  const startMs = Date.now()
  try {
    const res = await fetch(url, init)
    const body = await res.text()
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      headers[key] = value
    })
    const duration_ms = Date.now() - startMs
    onHttpComplete?.({
      method,
      url: truncateUrl(url),
      status: res.status,
      duration_ms,
    })
    return { status: res.status, body, headers, json: () => JSON.parse(body) }
  } catch (err) {
    if (isRedirectLimitError(err)) {
      throw new HttpRequestError(
        'HTTP_REDIRECT_ERROR',
        `Redirect limit exceeded for ${method} ${url}. This endpoint may redirect in a loop; use { redirect: "manual" } to handle 3xx responses explicitly.`,
        url,
        method,
        { cause: err }
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new HttpRequestError(
      'HTTP_FETCH_ERROR',
      `HTTP request failed for ${method} ${url}: ${message}`,
      url,
      method,
      { cause: err instanceof Error ? err : undefined }
    )
  }
}

export function buildCtx(options?: BuildCtxOptions): CtxBundle {
  const logs: string[] = []
  const assertions: AssertionCapture[] = []
  const onHttpComplete = options?.onHttpComplete

  const ctx: TestContext = {
    http: {
      async get(url, httpOptions) {
        const init: RequestInit = { method: 'GET' }
        if (httpOptions?.headers) init.headers = httpOptions.headers
        if (httpOptions?.redirect) init.redirect = httpOptions.redirect
        return doFetch(url, init, onHttpComplete)
      },
      async post(url, body, httpOptions) {
        const init: RequestInit = {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...httpOptions?.headers },
          body: JSON.stringify(body),
        }
        if (httpOptions?.redirect) init.redirect = httpOptions.redirect
        return doFetch(url, init, onHttpComplete)
      },
    },
    assert(name, value, message) {
      const passed = Boolean(value)
      assertions.push({ name, passed, message: message ?? null })
      if (!passed) {
        throw new Error(message ?? `Assertion "${name}" failed`)
      }
    },
    log(message) {
      logs.push(message)
      options?.onLog?.(message)
    },
    now() {
      return new Date()
    },
  }

  return {
    ctx,
    getLogs: () => logs,
    getAssertions: () => assertions,
  }
}
