import { fetch } from 'undici'
import type { RequestInit } from 'undici'
import { Client as FtpClient } from 'basic-ftp'
import { createHash, createHmac } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
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

export interface S3Options {
  accessKey: string
  secretKey: string
  region: string
  /** For temporary/STS credentials. */
  sessionToken?: string
  /** Extra headers (e.g. Range) — included in the SigV4 signature. */
  headers?: Record<string, string>
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
  s3: {
    get(url: string, options: S3Options): Promise<HttpResponse>
    head(url: string, options: S3Options): Promise<HttpResponse>
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

export interface S3CompleteInfo {
  method: 'GET' | 'HEAD'
  url: string
  status: number
  duration_ms: number
  region: string
}

export interface BuildCtxOptions {
  onLog?: (message: string) => void
  onHttpComplete?: (info: HttpCompleteInfo) => void
  onFtpComplete?: (info: FtpCompleteInfo) => void
  onS3Complete?: (info: S3CompleteInfo) => void
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

export class S3RequestError extends Error {
  readonly code: 'S3_SIGNING_ERROR' | 'S3_FETCH_ERROR' | 'S3_SIZE_LIMIT_ERROR'
  readonly url: string
  readonly method: string

  constructor(
    code: S3RequestError['code'],
    message: string,
    url: string,
    method: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'S3RequestError'
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

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

function hmac(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function awsUriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
}

function canonicalUri(pathname: string): string {
  if (pathname === '') return '/'
  return pathname
    .split('/')
    .map((segment) => awsUriEncode(decodeURIComponent(segment)))
    .join('/')
}

function canonicalQueryString(url: URL): string {
  const params: Array<[string, string]> = []
  url.searchParams.forEach((value, key) => params.push([key, value]))
  params.sort(([ka, va], [kb, vb]) => (ka === kb ? (va < vb ? -1 : va > vb ? 1 : 0) : ka < kb ? -1 : 1))
  return params.map(([k, v]) => `${awsUriEncode(k)}=${awsUriEncode(v)}`).join('&')
}

function getSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(Buffer.from(`AWS4${secretKey}`, 'utf8'), dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

function signS3Request(
  method: 'GET' | 'HEAD',
  url: URL,
  s3Options: S3Options,
  now: Date
): Record<string, string> {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256Hex('')

  const headersToSign: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }
  if (s3Options.sessionToken) headersToSign['x-amz-security-token'] = s3Options.sessionToken
  for (const [name, value] of Object.entries(s3Options.headers ?? {})) {
    headersToSign[name.toLowerCase()] = value.trim()
  }

  const sortedHeaderNames = Object.keys(headersToSign).sort()
  const canonicalHeaders = sortedHeaderNames.map((name) => `${name}:${headersToSign[name]}\n`).join('')
  const signedHeaders = sortedHeaderNames.join(';')

  const canonicalRequest = [
    method,
    canonicalUri(url.pathname),
    canonicalQueryString(url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${s3Options.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = getSigningKey(s3Options.secretKey, dateStamp, s3Options.region, 's3')
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${s3Options.accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    ...(s3Options.headers ?? {}),
    Authorization: authorization,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    ...(s3Options.sessionToken ? { 'x-amz-security-token': s3Options.sessionToken } : {}),
  }
}

function signS3OrThrow(method: 'GET' | 'HEAD', url: string, s3Options: S3Options): Record<string, string> {
  try {
    return signS3Request(method, new URL(url), s3Options, new Date())
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new S3RequestError(
      'S3_SIGNING_ERROR',
      `Failed to sign S3 request for ${method} ${url}: ${message}`,
      url,
      method,
      { cause: err instanceof Error ? err : undefined }
    )
  }
}

async function doS3Head(
  url: string,
  s3Options: S3Options,
  onS3Complete?: BuildCtxOptions['onS3Complete']
): Promise<HttpResponse> {
  const signedHeaders = signS3OrThrow('HEAD', url, s3Options)
  const startMs = Date.now()
  try {
    const response = await doFetch(url, { method: 'HEAD', headers: signedHeaders })
    onS3Complete?.({
      method: 'HEAD',
      url: truncateUrl(url),
      status: response.status,
      duration_ms: Date.now() - startMs,
      region: s3Options.region,
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new S3RequestError(
      'S3_FETCH_ERROR',
      `S3 request failed for HEAD ${url}: ${message}`,
      url,
      'HEAD',
      { cause: err instanceof Error ? err : undefined }
    )
  }
}

// Downloads to a server-managed temp file in FTP_TEMP_DIR — same directory (and periodic
// sweep backstop) that ctx.ftp.get uses — rather than buffering the whole object in
// memory, and aborts the underlying fetch as soon as FTP_MAX_DOWNLOAD_BYTES is exceeded.
async function doS3Get(
  url: string,
  s3Options: S3Options,
  onS3Complete?: BuildCtxOptions['onS3Complete']
): Promise<HttpResponse> {
  const signedHeaders = signS3OrThrow('GET', url, s3Options)

  const startMs = Date.now()
  const tempPath = join(FTP_TEMP_DIR, `${nanoid()}.tmp`)
  const controller = new AbortController()
  let sizeLimitExceeded = false

  try {
    await mkdir(FTP_TEMP_DIR, { recursive: true })
    const res = await fetch(url, { method: 'GET', headers: signedHeaders, signal: controller.signal })
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      headers[key] = value
    })

    const handle = await open(tempPath, 'w')
    try {
      let bytesWritten = 0
      if (res.body) {
        for await (const chunk of res.body) {
          bytesWritten += chunk.length
          if (bytesWritten > FTP_MAX_DOWNLOAD_BYTES) {
            sizeLimitExceeded = true
            controller.abort()
            break
          }
          await handle.write(chunk)
        }
      }
    } finally {
      await handle.close()
    }

    if (sizeLimitExceeded) {
      throw new S3RequestError(
        'S3_SIZE_LIMIT_ERROR',
        `S3 download exceeded max size of ${FTP_MAX_DOWNLOAD_BYTES} bytes for GET ${url}`,
        url,
        'GET'
      )
    }

    const buf = await readFile(tempPath)
    const body = buf.toString('utf-8')
    onS3Complete?.({
      method: 'GET',
      url: truncateUrl(url),
      status: res.status,
      duration_ms: Date.now() - startMs,
      region: s3Options.region,
    })
    return { status: res.status, body, headers, json: () => JSON.parse(body) }
  } catch (err) {
    if (err instanceof S3RequestError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new S3RequestError(
      'S3_FETCH_ERROR',
      `S3 request failed for GET ${url}: ${message}`,
      url,
      'GET',
      { cause: err instanceof Error ? err : undefined }
    )
  } finally {
    await unlink(tempPath).catch(() => {})
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
  const onS3Complete = options?.onS3Complete
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
    s3: {
      async get(url, s3Options) {
        return doS3Get(url, s3Options, onS3Complete)
      },
      async head(url, s3Options) {
        return doS3Head(url, s3Options, onS3Complete)
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
