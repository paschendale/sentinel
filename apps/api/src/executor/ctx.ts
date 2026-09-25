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
  /** Per-request limit in ms, covering response headers and the full body. Defaults to what is left of the test's timeout budget. */
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
  /** Per-request limit in ms, covering response headers and the full body. Defaults to what is left of the test's timeout budget. */
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
  /** ctx I/O calls still pending, described with elapsed time and progress — used in the run's timeout message. */
  getInFlight: () => string[]
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

export interface IoErrorInfo {
  protocol: 'http' | 's3' | 'ftp'
  op: string
  url: string
  code: string
  duration_ms: number
  message: string
}

export interface BuildCtxOptions {
  onLog?: (message: string) => void
  onHttpComplete?: (info: HttpCompleteInfo) => void
  onFtpComplete?: (info: FtpCompleteInfo) => void
  onS3Complete?: (info: S3CompleteInfo) => void
  /** Called when a ctx.http / ctx.s3 / ctx.ftp call fails or times out. */
  onIoError?: (info: IoErrorInfo) => void
  /** The test's overall timeout budget — default per-request limit for ctx.http/ctx.s3, and default FTP socket timeout. */
  testTimeoutMs?: number
  /** Aborted by the executor when the run times out; cancels every in-flight ctx I/O call. */
  signal?: AbortSignal
  /** Decrypted secrets snapshot (see executor/secrets-cache.ts), exposed as ctx.secrets.NAME. */
  secrets?: Readonly<Record<string, string>>
}

function truncateUrl(url: string, max = 200): string {
  return url.length > max ? `${url.slice(0, max)}…` : url
}

/** One pending ctx I/O call, reported in the run's error_message if the run times out while it is in flight. */
interface InFlightCall {
  label: string
  startMs: number
  headersReceived: boolean
  bytes: number
}

/** Per-run I/O state shared by every ctx call of one run. */
interface IoScope {
  runSignal?: AbortSignal | undefined
  /** Ms left of the test's timeout budget; undefined when the ctx was built without one. */
  remainingMs: () => number | undefined
  track: (label: string) => InFlightCall
  untrack: (call: InFlightCall) => void
  onIoError?: ((info: IoErrorInfo) => void) | undefined
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function describeProgress(call: InFlightCall | undefined): string {
  if (call == null) return 'progress unknown'
  if (!call.headersReceived) return 'no response headers received'
  return `headers received, ${formatBytes(call.bytes)} of body read`
}

function describeInFlight(call: InFlightCall, nowMs: number): string {
  return `${call.label} (${((nowMs - call.startMs) / 1000).toFixed(1)}s, ${describeProgress(call)})`
}

function resolveTimeoutMs(explicit: number | undefined, scope: IoScope | undefined): number | undefined {
  if (explicit !== undefined) {
    if (typeof explicit !== 'number' || !Number.isFinite(explicit) || explicit <= 0) {
      throw new TypeError(`timeout must be a positive number of milliseconds, got ${String(explicit)}`)
    }
    return explicit
  }
  const remaining = scope?.remainingMs()
  return remaining === undefined ? undefined : Math.max(1, remaining)
}

/** Combines the run's abort signal, a per-request timeout signal and any caller-supplied signal. */
function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => s !== undefined)
  if (present.length === 0) return undefined
  if (present.length === 1) return present[0]
  return AbortSignal.any(present)
}

function runAbortedMessage(scope: IoScope | undefined): string | null {
  if (scope?.runSignal?.aborted !== true) return null
  const reason: unknown = scope.runSignal.reason
  return reason instanceof Error ? reason.message : 'test run aborted'
}

type HttpRequestErrorCode = 'HTTP_FETCH_ERROR' | 'HTTP_REDIRECT_ERROR' | 'HTTP_TIMEOUT_ERROR'

export class HttpRequestError extends Error {
  readonly code: HttpRequestErrorCode
  readonly url: string
  readonly method: string

  constructor(
    code: HttpRequestErrorCode,
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
  readonly code: 'S3_SIGNING_ERROR' | 'S3_FETCH_ERROR' | 'S3_SIZE_LIMIT_ERROR' | 'S3_TIMEOUT_ERROR'
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

interface FetchOptions {
  scope?: IoScope | undefined
  /** Per-request limit (headers + full body), already resolved by the caller. */
  timeoutMs?: number | undefined
  onHttpComplete?: BuildCtxOptions['onHttpComplete'] | undefined
}

async function doFetch(url: string, init: RequestInit, options: FetchOptions = {}): Promise<HttpResponse> {
  const { scope, timeoutMs, onHttpComplete } = options
  const method = init.method ?? 'GET'
  const startMs = Date.now()
  const call = scope?.track(`${method} ${truncateUrl(url)}`)
  const timeoutSignal = timeoutMs === undefined ? undefined : AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)))
  const signal = combineSignals([scope?.runSignal, timeoutSignal, init.signal ?? undefined])
  try {
    const res = await fetch(url, { ...init, signal: signal ?? null })
    if (call) call.headersReceived = true
    // Read the body as a stream (not res.text()) so a timeout can report how far the download got.
    const chunks: Uint8Array[] = []
    if (res.body) {
      for await (const chunk of res.body) {
        chunks.push(chunk)
        if (call) call.bytes += chunk.byteLength
      }
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks))
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
    const httpErr = toHttpRequestError(err, url, method, timeoutMs, timeoutSignal, scope, call)
    scope?.onIoError?.({
      protocol: 'http',
      op: method,
      url: truncateUrl(url),
      code: httpErr.code,
      duration_ms: Date.now() - startMs,
      message: httpErr.message,
    })
    throw httpErr
  } finally {
    if (call) scope?.untrack(call)
  }
}

function toHttpRequestError(
  err: unknown,
  url: string,
  method: string,
  timeoutMs: number | undefined,
  timeoutSignal: AbortSignal | undefined,
  scope: IoScope | undefined,
  call: InFlightCall | undefined
): HttpRequestError {
  const cause = err instanceof Error ? err : undefined
  const runAborted = runAbortedMessage(scope)
  if (runAborted != null) {
    return new HttpRequestError(
      'HTTP_FETCH_ERROR',
      `HTTP request aborted for ${method} ${url}: ${runAborted} (${describeProgress(call)})`,
      url,
      method,
      { cause }
    )
  }
  if (timeoutSignal?.aborted === true) {
    return new HttpRequestError(
      'HTTP_TIMEOUT_ERROR',
      `HTTP request timed out for ${method} ${url} after ${timeoutMs}ms (${describeProgress(call)})`,
      url,
      method,
      { cause }
    )
  }
  if (isRedirectLimitError(err)) {
    return new HttpRequestError(
      'HTTP_REDIRECT_ERROR',
      `Redirect limit exceeded for ${method} ${url}. This endpoint may redirect in a loop; use { redirect: "manual" } to handle 3xx responses explicitly.`,
      url,
      method,
      { cause }
    )
  }
  const message = err instanceof Error ? err.message : String(err)
  return new HttpRequestError('HTTP_FETCH_ERROR', `HTTP request failed for ${method} ${url}: ${message}`, url, method, {
    cause,
  })
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

function toS3RequestError(
  err: unknown,
  url: string,
  method: 'GET' | 'HEAD',
  timeoutMs: number | undefined,
  timeoutSignal: AbortSignal | undefined,
  scope: IoScope | undefined,
  call: InFlightCall | undefined
): S3RequestError {
  if (err instanceof S3RequestError) return err
  const cause = err instanceof Error ? err : undefined
  const runAborted = runAbortedMessage(scope)
  if (runAborted != null) {
    return new S3RequestError(
      'S3_FETCH_ERROR',
      `S3 request aborted for ${method} ${url}: ${runAborted} (${describeProgress(call)})`,
      url,
      method,
      { cause }
    )
  }
  const timedOut =
    timeoutSignal?.aborted === true || (err instanceof HttpRequestError && err.code === 'HTTP_TIMEOUT_ERROR')
  if (timedOut) {
    return new S3RequestError(
      'S3_TIMEOUT_ERROR',
      `S3 request timed out for ${method} ${url} after ${timeoutMs}ms (${describeProgress(call)})`,
      url,
      method,
      { cause }
    )
  }
  const message = err instanceof Error ? err.message : String(err)
  return new S3RequestError('S3_FETCH_ERROR', `S3 request failed for ${method} ${url}: ${message}`, url, method, {
    cause,
  })
}

function reportS3Error(scope: IoScope | undefined, err: S3RequestError, startMs: number): void {
  scope?.onIoError?.({
    protocol: 's3',
    op: err.method,
    url: truncateUrl(err.url),
    code: err.code,
    duration_ms: Date.now() - startMs,
    message: err.message,
  })
}

async function doS3Head(
  url: string,
  s3Options: S3Options,
  scope: IoScope | undefined,
  onS3Complete?: BuildCtxOptions['onS3Complete']
): Promise<HttpResponse> {
  const signedHeaders = signS3OrThrow('HEAD', url, s3Options)
  const timeoutMs = resolveTimeoutMs(s3Options.timeout, scope)
  const startMs = Date.now()
  try {
    // doFetch tracks the call and enforces the timeout; S3 reports its own error event below.
    const fetchScope = scope && { ...scope, onIoError: undefined }
    const response = await doFetch(url, { method: 'HEAD', headers: signedHeaders }, { scope: fetchScope, timeoutMs })
    onS3Complete?.({
      method: 'HEAD',
      url: truncateUrl(url),
      status: response.status,
      duration_ms: Date.now() - startMs,
      region: s3Options.region,
    })
    return response
  } catch (err) {
    const s3Err = toS3RequestError(err, url, 'HEAD', timeoutMs, undefined, scope, undefined)
    reportS3Error(scope, s3Err, startMs)
    throw s3Err
  }
}

// Downloads to a server-managed temp file in FTP_TEMP_DIR — same directory (and periodic
// sweep backstop) that ctx.ftp.get uses — rather than buffering the whole object in
// memory, and aborts the underlying fetch as soon as FTP_MAX_DOWNLOAD_BYTES is exceeded.
async function doS3Get(
  url: string,
  s3Options: S3Options,
  scope: IoScope | undefined,
  onS3Complete?: BuildCtxOptions['onS3Complete']
): Promise<HttpResponse> {
  const signedHeaders = signS3OrThrow('GET', url, s3Options)
  const timeoutMs = resolveTimeoutMs(s3Options.timeout, scope)

  const startMs = Date.now()
  const tempPath = join(FTP_TEMP_DIR, `${nanoid()}.tmp`)
  const controller = new AbortController()
  const timeoutSignal = timeoutMs === undefined ? undefined : AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)))
  const signal = combineSignals([controller.signal, scope?.runSignal, timeoutSignal])
  const call = scope?.track(`S3 GET ${truncateUrl(url)}`)
  let sizeLimitExceeded = false

  try {
    await mkdir(FTP_TEMP_DIR, { recursive: true })
    const res = await fetch(url, { method: 'GET', headers: signedHeaders, signal: signal ?? null })
    if (call) call.headersReceived = true
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
          if (call) call.bytes = bytesWritten
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
    const s3Err = toS3RequestError(err, url, 'GET', timeoutMs, timeoutSignal, scope, call)
    reportS3Error(scope, s3Err, startMs)
    throw s3Err
  } finally {
    if (call) scope?.untrack(call)
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

interface FtpConnection {
  client: FtpClient
  path: string
  host: string
  /** Detaches the run-abort listener; call once the operation is over. */
  release: () => void
}

async function connectFtp(
  url: string,
  ftpOptions: FtpOptions | undefined,
  testTimeoutMs: number | undefined,
  scope: IoScope | undefined
): Promise<FtpConnection> {
  const startMs = Date.now()
  const { host, port, user, password, secure, path } = parseFtpUrl(url, ftpOptions)
  const runAbortedBefore = runAbortedMessage(scope)
  if (runAbortedBefore != null) {
    throw new FtpRequestError('FTP_CONNECT_ERROR', `FTP connection aborted for ${host}:${port}: ${runAbortedBefore}`, url, path)
  }
  const client = new FtpClient(ftpOptions?.timeout ?? testTimeoutMs ?? 10_000)
  // basic-ftp takes no AbortSignal; closing the client rejects whatever operation is pending.
  const onRunAbort = (): void => client.close()
  scope?.runSignal?.addEventListener('abort', onRunAbort, { once: true })
  const release = (): void => scope?.runSignal?.removeEventListener('abort', onRunAbort)
  try {
    await client.access({ host, port, user, password, secure })
  } catch (err) {
    release()
    client.close()
    const message = runAbortedMessage(scope) ?? (err instanceof Error ? err.message : String(err))
    const ftpErr = new FtpRequestError(
      'FTP_CONNECT_ERROR',
      `FTP connection failed for ${host}:${port}: ${message}`,
      url,
      path,
      { cause: err instanceof Error ? err : undefined }
    )
    reportFtpError(scope, 'connect', ftpErr, startMs)
    throw ftpErr
  }
  return { client, path, host, release }
}

function reportFtpError(scope: IoScope | undefined, op: string, err: FtpRequestError, startMs: number): void {
  scope?.onIoError?.({
    protocol: 'ftp',
    op,
    url: truncateUrl(err.url),
    code: err.code,
    duration_ms: Date.now() - startMs,
    message: err.message,
  })
}

async function doFtpList(
  url: string,
  ftpOptions: FtpOptions | undefined,
  testTimeoutMs: number | undefined,
  scope: IoScope | undefined,
  onFtpComplete?: BuildCtxOptions['onFtpComplete']
): Promise<FtpEntry[]> {
  const startMs = Date.now()
  const call = scope?.track(`FTP LIST ${truncateUrl(url)}`)
  try {
    const { client, path, host, release } = await connectFtp(url, ftpOptions, testTimeoutMs, scope)
    if (call) call.headersReceived = true
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
      const message = runAbortedMessage(scope) ?? (err instanceof Error ? err.message : String(err))
      const ftpErr = new FtpRequestError(
        'FTP_LIST_ERROR',
        `FTP list failed for ${path} on ${host}: ${message}`,
        url,
        path,
        { cause: err instanceof Error ? err : undefined }
      )
      reportFtpError(scope, 'ls', ftpErr, startMs)
      throw ftpErr
    } finally {
      release()
      client.close()
    }
  } finally {
    if (call) scope?.untrack(call)
  }
}

async function doFtpGet(
  url: string,
  ftpOptions: FtpOptions | undefined,
  testTimeoutMs: number | undefined,
  scope: IoScope | undefined,
  onFtpComplete?: BuildCtxOptions['onFtpComplete']
): Promise<FtpDownloadResult> {
  const startMs = Date.now()
  const call = scope?.track(`FTP GET ${truncateUrl(url)}`)
  try {
    const { client, path, host, release } = await connectFtp(url, ftpOptions, testTimeoutMs, scope)
    if (call) call.headersReceived = true
    const tempPath = join(FTP_TEMP_DIR, `${nanoid()}.tmp`)
    let sizeLimitExceeded = false
    try {
      await mkdir(FTP_TEMP_DIR, { recursive: true })
      client.trackProgress((info) => {
        if (call) call.bytes = info.bytes
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
      const ftpErr = sizeLimitExceeded
        ? new FtpRequestError(
            'FTP_SIZE_LIMIT_ERROR',
            `FTP download exceeded max size of ${FTP_MAX_DOWNLOAD_BYTES} bytes for ${path} on ${host}`,
            url,
            path
          )
        : new FtpRequestError(
            'FTP_DOWNLOAD_ERROR',
            `FTP download failed for ${path} on ${host}: ${runAbortedMessage(scope) ?? (err instanceof Error ? err.message : String(err))}`,
            url,
            path,
            { cause: err instanceof Error ? err : undefined }
          )
      reportFtpError(scope, 'get', ftpErr, startMs)
      throw ftpErr
    } finally {
      release()
      client.trackProgress(undefined)
      client.close()
      await unlink(tempPath).catch(() => {})
    }
  } finally {
    if (call) scope?.untrack(call)
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
  const ctxStartMs = Date.now()
  const inFlight = new Set<InFlightCall>()

  const scope: IoScope = {
    runSignal: options?.signal,
    remainingMs: () => (testTimeoutMs === undefined ? undefined : testTimeoutMs - (Date.now() - ctxStartMs)),
    track(label) {
      const call: InFlightCall = { label, startMs: Date.now(), headersReceived: false, bytes: 0 }
      inFlight.add(call)
      return call
    },
    untrack(call) {
      inFlight.delete(call)
    },
    onIoError: options?.onIoError,
  }

  const ctx: TestContext = {
    http: {
      async get(url, httpOptions) {
        const init: RequestInit = { method: 'GET' }
        if (httpOptions?.headers) init.headers = httpOptions.headers
        if (httpOptions?.redirect) init.redirect = httpOptions.redirect
        const timeoutMs = resolveTimeoutMs(httpOptions?.timeout, scope)
        return doFetch(url, init, { scope, timeoutMs, onHttpComplete })
      },
      async post(url, body, httpOptions) {
        const init: RequestInit = {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...httpOptions?.headers },
          body: JSON.stringify(body),
        }
        if (httpOptions?.redirect) init.redirect = httpOptions.redirect
        const timeoutMs = resolveTimeoutMs(httpOptions?.timeout, scope)
        return doFetch(url, init, { scope, timeoutMs, onHttpComplete })
      },
    },
    ftp: {
      async ls(url, ftpOptions) {
        return doFtpList(url, ftpOptions, testTimeoutMs, scope, onFtpComplete)
      },
      async get(url, ftpOptions) {
        return doFtpGet(url, ftpOptions, testTimeoutMs, scope, onFtpComplete)
      },
    },
    s3: {
      async get(url, s3Options) {
        return doS3Get(url, s3Options, scope, onS3Complete)
      },
      async head(url, s3Options) {
        return doS3Head(url, s3Options, scope, onS3Complete)
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
    getInFlight: () => {
      const nowMs = Date.now()
      return [...inFlight].map((call) => describeInFlight(call, nowMs))
    },
  }
}
