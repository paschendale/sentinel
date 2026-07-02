import { fetch } from 'undici'
import type { RequestInit } from 'undici'
import { Client as FtpClient } from 'basic-ftp'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { nanoid } from 'nanoid'
import type { AssertionResult } from '@sentinel/shared'
import { FTP_MAX_DOWNLOAD_BYTES, FTP_TEMP_DIR } from '../config.js'

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

export interface FtpEntry {
  name: string
  type: 'file' | 'directory' | 'unknown'
  size: number
  modifiedAt: Date | null
}

export interface FtpDownloadResult {
  body: string
  size: number
}

export interface FtpOptions {
  user?: string
  password?: string
  /** FTPS (explicit TLS). Default false. */
  secure?: boolean
  /** Per-connection socket timeout, ms. Defaults to the test's own timeout budget. */
  timeout?: number
}

export interface TestContext {
  http: {
    get(url: string, options?: HttpOptions): Promise<HttpResponse>
    post(url: string, body: unknown, options?: HttpOptions): Promise<HttpResponse>
  }
  ftp: {
    ls(url: string, options?: FtpOptions): Promise<FtpEntry[]>
    get(url: string, options?: FtpOptions): Promise<FtpDownloadResult>
  }
  assert: (name: string, value: unknown, message?: string) => void
  warn: (message: string) => void
  log: (message: string) => void
  now: () => Date
  secrets: Readonly<Record<string, string>>
}

type AssertionCapture = Omit<AssertionResult, 'id' | 'test_run_id'>

interface CtxBundle {
  ctx: TestContext
  getLogs: () => string[]
  getAssertions: () => AssertionCapture[]
  getWarnings: () => string[]
}

export interface HttpCompleteInfo {
  method: string
  url: string
  status: number
  duration_ms: number
}

export interface FtpCompleteInfo {
  op: 'ls' | 'get'
  host: string
  path: string
  duration_ms: number
  size?: number
}

export interface BuildCtxOptions {
  onLog?: (message: string) => void
  onHttpComplete?: (info: HttpCompleteInfo) => void
  onFtpComplete?: (info: FtpCompleteInfo) => void
  /** The test's overall timeout budget — used as the default FTP socket timeout. */
  testTimeoutMs?: number
  /** Decrypted secrets snapshot (see executor/secrets-cache.ts), exposed as ctx.secrets.NAME. */
  secrets?: Readonly<Record<string, string>>
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

export class FtpRequestError extends Error {
  readonly code: 'FTP_CONNECT_ERROR' | 'FTP_LIST_ERROR' | 'FTP_DOWNLOAD_ERROR' | 'FTP_SIZE_LIMIT_ERROR'
  readonly url: string
  readonly path: string

  constructor(
    code: FtpRequestError['code'],
    message: string,
    url: string,
    path: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'FtpRequestError'
    this.code = code
    this.url = url
    this.path = path
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

interface ParsedFtpUrl {
  host: string
  port: number
  user: string
  password: string
  secure: boolean
  path: string
}

function parseFtpUrl(url: string, ftpOptions?: FtpOptions): ParsedFtpUrl {
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 21,
    user: ftpOptions?.user ?? (parsed.username ? decodeURIComponent(parsed.username) : 'anonymous'),
    password: ftpOptions?.password ?? (parsed.password ? decodeURIComponent(parsed.password) : 'guest'),
    secure: ftpOptions?.secure ?? false,
    path: decodeURIComponent(parsed.pathname) || '/',
  }
}

async function connectFtp(
  url: string,
  ftpOptions: FtpOptions | undefined,
  testTimeoutMs: number | undefined
): Promise<{ client: FtpClient; path: string; host: string }> {
  const { host, port, user, password, secure, path } = parseFtpUrl(url, ftpOptions)
  const client = new FtpClient(ftpOptions?.timeout ?? testTimeoutMs ?? 10_000)
  try {
    await client.access({ host, port, user, password, secure })
  } catch (err) {
    client.close()
    const message = err instanceof Error ? err.message : String(err)
    throw new FtpRequestError(
      'FTP_CONNECT_ERROR',
      `FTP connection failed for ${host}:${port}: ${message}`,
      url,
      path,
      { cause: err instanceof Error ? err : undefined }
    )
  }
  return { client, path, host }
}

async function doFtpList(
  url: string,
  ftpOptions: FtpOptions | undefined,
  testTimeoutMs: number | undefined,
  onFtpComplete?: BuildCtxOptions['onFtpComplete']
): Promise<FtpEntry[]> {
  const startMs = Date.now()
  const { client, path, host } = await connectFtp(url, ftpOptions, testTimeoutMs)
  try {
    const list = await client.list(path)
    const entries: FtpEntry[] = list.map((f) => ({
      name: f.name,
      type: f.isDirectory ? 'directory' : f.isFile ? 'file' : 'unknown',
      size: f.size,
      modifiedAt: f.modifiedAt ?? null,
    }))
    onFtpComplete?.({ op: 'ls', host, path, duration_ms: Date.now() - startMs })
    return entries
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new FtpRequestError(
      'FTP_LIST_ERROR',
      `FTP list failed for ${path} on ${host}: ${message}`,
      url,
      path,
      { cause: err instanceof Error ? err : undefined }
    )
  } finally {
    client.close()
  }
}

async function doFtpGet(
  url: string,
  ftpOptions: FtpOptions | undefined,
  testTimeoutMs: number | undefined,
  onFtpComplete?: BuildCtxOptions['onFtpComplete']
): Promise<FtpDownloadResult> {
  const startMs = Date.now()
  const { client, path, host } = await connectFtp(url, ftpOptions, testTimeoutMs)
  const tempPath = join(FTP_TEMP_DIR, `${nanoid()}.tmp`)
  let sizeLimitExceeded = false
  try {
    await mkdir(FTP_TEMP_DIR, { recursive: true })
    client.trackProgress((info) => {
      if (info.bytes > FTP_MAX_DOWNLOAD_BYTES) {
        sizeLimitExceeded = true
        client.close()
      }
    })
    await client.downloadTo(tempPath, path)
    const buf = await readFile(tempPath)
    const body = buf.toString('utf-8')
    onFtpComplete?.({ op: 'get', host, path, duration_ms: Date.now() - startMs, size: buf.length })
    return { body, size: buf.length }
  } catch (err) {
    if (sizeLimitExceeded) {
      throw new FtpRequestError(
        'FTP_SIZE_LIMIT_ERROR',
        `FTP download exceeded max size of ${FTP_MAX_DOWNLOAD_BYTES} bytes for ${path} on ${host}`,
        url,
        path
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new FtpRequestError(
      'FTP_DOWNLOAD_ERROR',
      `FTP download failed for ${path} on ${host}: ${message}`,
      url,
      path,
      { cause: err instanceof Error ? err : undefined }
    )
  } finally {
    client.trackProgress(undefined)
    client.close()
    await unlink(tempPath).catch(() => {})
  }
}

export function buildCtx(options?: BuildCtxOptions): CtxBundle {
  const logs: string[] = []
  const assertions: AssertionCapture[] = []
  const warnings: string[] = []
  const onHttpComplete = options?.onHttpComplete
  const onFtpComplete = options?.onFtpComplete
  const testTimeoutMs = options?.testTimeoutMs

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
    ftp: {
      async ls(url, ftpOptions) {
        return doFtpList(url, ftpOptions, testTimeoutMs, onFtpComplete)
      },
      async get(url, ftpOptions) {
        return doFtpGet(url, ftpOptions, testTimeoutMs, onFtpComplete)
      },
    },
    assert(name, value, message) {
      const passed = Boolean(value)
      assertions.push({ name, passed, message: message ?? null })
      if (!passed) {
        throw new Error(message ?? `Assertion "${name}" failed`)
      }
    },
    warn(message) {
      warnings.push(message)
      options?.onLog?.(`[WARN] ${message}`)
    },
    log(message) {
      logs.push(message)
      options?.onLog?.(message)
    },
    now() {
      return new Date()
    },
    secrets: options?.secrets ?? {},
  }

  return {
    ctx,
    getLogs: () => logs,
    getAssertions: () => assertions,
    getWarnings: () => warnings,
  }
}
