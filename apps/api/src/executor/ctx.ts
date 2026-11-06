import { Agent, fetch } from 'undici'
import type { Dispatcher, RequestInit } from 'undici'
import { Client as FtpClient } from 'basic-ftp'
import { createHash, createHmac } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { nanoid } from 'nanoid'
import type { AssertionResult } from '@sentinel/shared'
import { FTP_MAX_DOWNLOAD_BYTES, FTP_TEMP_DIR } from '../config.js'
import { withSentinelHeaders } from '../outbound-headers.js'

export interface HttpResponse {
  status: number
  body: string
  headers: Record<string, string>
  json(): unknown
}

export interface HttpOptions {
  headers?: Record<string, string>
  /** Per-request limit in ms, covering response headers and the full body. Without it, the request is bounded by the run's timeout_ms. */
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
  /** Per-request limit in ms, covering response headers and the full body. Without it, the request is bounded by the run's timeout_ms. */
  timeout?: number
}

export interface S3ListOptions extends S3Options {
  /** Only keys starting with this prefix. */
  prefix?: string
  /** Roll keys up at this delimiter (usually '/'); rolled-up groups come back in `prefixes`. */
  delimiter?: string
  /** Keys per page, 1..1000 (default: the service's own default, 1000). */
  maxKeys?: number
  /** Start listing after this key (lexicographic). */
  startAfter?: string
  /** Follow continuation tokens until the listing is exhausted, capped at S3_LIST_MAX_KEYS keys. Default: one page. */
  all?: boolean
}

export interface S3Object {
  key: string
  size: number
  lastModified: Date | null
  etag: string | null
  storageClass: string | null
}

export interface S3ListResult {
  objects: S3Object[]
  /** Common prefixes, when `delimiter` was given. */
  prefixes: string[]
  /** True when more keys exist beyond what was returned (one page without `all`, or the cap with it). */
  truncated: boolean
}

export interface K8sOptions {
  /** Bearer token, normally a ServiceAccount token read from ctx.secrets. */
  token: string
  /** PEM certificate bundle the API server's certificate must chain to. Without it the system trust store is used. */
  ca?: string
  /** Extra request headers. */
  headers?: Record<string, string>
  /** Per-request limit in ms, covering response headers and the full body. Without it, the request is bounded by the run's timeout_ms. */
  timeout?: number
}

export interface K8sResourceOptions extends K8sOptions {
  /** API group; omit (or '') for the core group (`/api/v1`). */
  group?: string
  /** API version, e.g. 'v1'. */
  version: string
  /** Plural resource name, e.g. 'cronjobs', 'deployments', 'workflows'. */
  resource: string
  /** Omit for cluster-scoped resources or a list across every namespace. */
  namespace?: string
}

export interface K8sListOptions extends K8sResourceOptions {
  labelSelector?: string
  fieldSelector?: string
  /** Max items; the server may return fewer. */
  limit?: number
}

export interface K8sReadOptions extends K8sResourceOptions {
  name: string
}

export type K8sObject = Record<string, unknown>

export interface K8sListResult {
  items: K8sObject[]
  /** Set when `limit` cut the list short. */
  continue: string | null
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
    list(url: string, options: S3ListOptions): Promise<S3ListResult>
  }
  k8s: {
    /** Raw GET of any API server path; same response shape as ctx.http, no status check. */
    get(url: string, options: K8sOptions): Promise<HttpResponse>
    /** Lists a resource; throws K8S_API_ERROR on a non-2xx response. */
    list(server: string, options: K8sListOptions): Promise<K8sListResult>
    /** Reads one object; throws K8S_API_ERROR on a non-2xx response (404 included). */
    read(server: string, options: K8sReadOptions): Promise<K8sObject>
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
  method: 'GET' | 'HEAD' | 'LIST'
  url: string
  status: number
  duration_ms: number
  region: string
  /** LIST only: keys returned and pages fetched. */
  keys?: number
  pages?: number
}

export interface K8sCompleteInfo {
  op: 'get' | 'list' | 'read'
  url: string
  status: number
  duration_ms: number
  /** list only */
  items?: number
}

export interface IoErrorInfo {
  protocol: 'http' | 's3' | 'ftp' | 'k8s'
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
  onK8sComplete?: (info: K8sCompleteInfo) => void
  /** Called when a ctx.http / ctx.s3 / ctx.ftp / ctx.k8s call fails or times out. */
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
  // Inside a run, the run's own deadline aborts the request. A second timer set to the same
  // deadline would race it and randomly turn the run's 'timeout' into a 'fail'.
  if (scope?.runSignal !== undefined) return undefined
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
  readonly code: 'S3_SIGNING_ERROR' | 'S3_FETCH_ERROR' | 'S3_SIZE_LIMIT_ERROR' | 'S3_TIMEOUT_ERROR' | 'S3_LIST_ERROR'
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

export class K8sRequestError extends Error {
  readonly code: 'K8S_CONFIG_ERROR' | 'K8S_FETCH_ERROR' | 'K8S_TIMEOUT_ERROR' | 'K8S_API_ERROR'
  readonly url: string
  readonly op: string
  /** HTTP status of the API server's response, for K8S_API_ERROR. */
  readonly status: number | null
  /** `reason` of the API server's Status object (e.g. 'NotFound', 'Forbidden'), when it sent one. */
  readonly reason: string | null

  constructor(
    code: K8sRequestError['code'],
    message: string,
    url: string,
    op: string,
    extra: { status?: number; reason?: string | null; cause?: Error | undefined } = {}
  ) {
    super(message, { cause: extra.cause })
    this.name = 'K8sRequestError'
    this.code = code
    this.url = url
    this.op = op
    this.status = extra.status ?? null
    this.reason = extra.reason ?? null
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
    // Sentinel's identifying headers stay unsigned, so they never affect the SigV4 signature.
    return withSentinelHeaders(signS3Request(method, new URL(url), s3Options, new Date()))
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
  method: 'GET' | 'HEAD' | 'LIST',
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

/** Hard cap on keys a single ctx.s3.list({ all: true }) call accumulates across pages. */
export const S3_LIST_MAX_KEYS = 10_000

function decodeXmlText(value: string): string {
  return value.replace(/&(quot|amp|lt|gt|apos|#x[0-9a-fA-F]+|#\d+);/g, (_match, entity: string) => {
    switch (entity) {
      case 'quot':
        return '"'
      case 'amp':
        return '&'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'apos':
        return "'"
      default:
        return String.fromCodePoint(entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10))
    }
  })
}

/** Text of the first `<tag>…</tag>` child in `xml`, entity-decoded; null when absent or self-closing. */
function xmlText(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  // A matched capturing group is always a string (possibly empty).
  return match === null ? null : decodeXmlText(match[1] as string)
}

function xmlBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = []
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g')
  for (let match = re.exec(xml); match !== null; match = re.exec(xml)) blocks.push(match[1] as string)
  return blocks
}

interface ListPage {
  objects: S3Object[]
  prefixes: string[]
  truncated: boolean
  nextToken: string | null
}

// ListObjectsV2 responses are flat, fixed-shape XML, so a few regexes cover them without an XML
// dependency. Keys are entity-decoded (S3 escapes &, <, > and quotes); no `encoding-type` is
// requested so the same parser works against every S3-compatible service.
function parseListObjectsV2(xml: string, url: string): ListPage {
  if (!/<ListBucketResult[\s>]/.test(xml)) {
    throw new S3RequestError('S3_LIST_ERROR', `S3 list returned an unexpected body for ${url}: ${xml.slice(0, 200)}`, url, 'LIST')
  }
  const objects: S3Object[] = xmlBlocks(xml, 'Contents').map((block) => {
    const lastModified = xmlText(block, 'LastModified')
    const parsed = lastModified === null ? NaN : Date.parse(lastModified)
    const etag = xmlText(block, 'ETag')
    return {
      key: xmlText(block, 'Key') ?? '',
      size: Number(xmlText(block, 'Size') ?? 0),
      lastModified: Number.isNaN(parsed) ? null : new Date(parsed),
      etag: etag === null ? null : etag.replace(/^"|"$/g, ''),
      storageClass: xmlText(block, 'StorageClass'),
    }
  })
  const prefixes = xmlBlocks(xml, 'CommonPrefixes')
    .map((block) => xmlText(block, 'Prefix'))
    .filter((prefix): prefix is string => prefix !== null)
  return {
    objects,
    prefixes,
    truncated: xmlText(xml, 'IsTruncated') === 'true',
    nextToken: xmlText(xml, 'NextContinuationToken'),
  }
}

function buildListUrl(base: URL, listOptions: S3ListOptions, continuationToken: string | null): string {
  const params: Array<[string, string]> = [['list-type', '2']]
  if (listOptions.prefix) params.push(['prefix', listOptions.prefix])
  if (listOptions.delimiter) params.push(['delimiter', listOptions.delimiter])
  if (listOptions.maxKeys !== undefined) params.push(['max-keys', String(listOptions.maxKeys)])
  if (listOptions.startAfter) params.push(['start-after', listOptions.startAfter])
  if (continuationToken !== null) params.push(['continuation-token', continuationToken])
  const url = new URL(base)
  // Encoded by hand (not URLSearchParams) so spaces become %20, matching the SigV4 canonical form.
  url.search = '?' + params.map(([key, value]) => `${awsUriEncode(key)}=${awsUriEncode(value)}`).join('&')
  return url.toString()
}

async function doS3List(
  url: string,
  listOptions: S3ListOptions,
  scope: IoScope | undefined,
  onS3Complete?: BuildCtxOptions['onS3Complete']
): Promise<S3ListResult> {
  const { maxKeys } = listOptions
  if (maxKeys !== undefined && (!Number.isInteger(maxKeys) || maxKeys < 1 || maxKeys > 1000)) {
    throw new TypeError(`maxKeys must be an integer between 1 and 1000, got ${String(maxKeys)}`)
  }
  const timeoutMs = resolveTimeoutMs(listOptions.timeout, scope)
  const startMs = Date.now()
  const objects: S3Object[] = []
  const prefixes: string[] = []
  let truncated = false
  let continuationToken: string | null = null
  let pages = 0
  let lastStatus = 0
  try {
    let base: URL
    try {
      base = new URL(url)
    } catch (err) {
      // `new URL` only ever throws a TypeError.
      const cause = err as Error
      throw new S3RequestError('S3_SIGNING_ERROR', `Failed to sign S3 request for LIST ${url}: ${cause.message}`, url, 'LIST', {
        cause,
      })
    }
    // doFetch tracks each page and enforces the per-request timeout; S3 reports its own error event below.
    const fetchScope = scope && { ...scope, onIoError: undefined }
    for (;;) {
      const pageUrl = buildListUrl(base, listOptions, continuationToken)
      const signedHeaders = signS3OrThrow('GET', pageUrl, listOptions)
      const response = await doFetch(pageUrl, { method: 'GET', headers: signedHeaders }, { scope: fetchScope, timeoutMs })
      pages += 1
      lastStatus = response.status
      if (response.status < 200 || response.status >= 300) {
        const code = xmlText(response.body, 'Code')
        const message = xmlText(response.body, 'Message')
        throw new S3RequestError(
          'S3_LIST_ERROR',
          `S3 list failed for ${url}: HTTP ${response.status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}`,
          url,
          'LIST'
        )
      }
      const page = parseListObjectsV2(response.body, url)
      objects.push(...page.objects)
      prefixes.push(...page.prefixes)
      truncated = page.truncated
      continuationToken = page.nextToken
      if (!listOptions.all || !truncated || continuationToken === null || objects.length >= S3_LIST_MAX_KEYS) break
    }
    onS3Complete?.({
      method: 'LIST',
      url: truncateUrl(url),
      status: lastStatus,
      duration_ms: Date.now() - startMs,
      region: listOptions.region,
      keys: objects.length,
      pages,
    })
    return { objects, prefixes, truncated }
  } catch (err) {
    const s3Err = toS3RequestError(err, url, 'LIST', timeoutMs, undefined, scope, undefined)
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

// One undici Agent per distinct CA bundle, so TLS sessions are reused across runs. A test
// deployment talks to a handful of clusters at most; the cap only guards against a test that
// passes a different bundle on every call.
const K8S_AGENT_CACHE_MAX = 16
const k8sAgents = new Map<string, Dispatcher>()

function k8sDispatcher(ca: string | undefined): Dispatcher | undefined {
  if (ca === undefined) return undefined
  const cached = k8sAgents.get(ca)
  if (cached !== undefined) return cached
  if (k8sAgents.size >= K8S_AGENT_CACHE_MAX) k8sAgents.clear()
  const agent = new Agent({ connect: { ca } })
  k8sAgents.set(ca, agent)
  return agent
}

function k8sRequestInit(k8sOptions: K8sOptions): RequestInit {
  if (typeof k8sOptions.token !== 'string' || k8sOptions.token === '') {
    throw new K8sRequestError('K8S_CONFIG_ERROR', 'ctx.k8s needs a non-empty token', '', 'get')
  }
  const init: RequestInit = {
    method: 'GET',
    headers: withSentinelHeaders({
      accept: 'application/json',
      ...k8sOptions.headers,
      authorization: `Bearer ${k8sOptions.token}`,
    }),
  }
  const dispatcher = k8sDispatcher(k8sOptions.ca)
  if (dispatcher !== undefined) init.dispatcher = dispatcher
  return init
}

function k8sResourcePath(server: string, resourceOptions: K8sResourceOptions, op: string): URL {
  let base: URL
  try {
    base = new URL(server)
  } catch (err) {
    // `new URL` only ever throws a TypeError.
    const cause = err as Error
    throw new K8sRequestError('K8S_CONFIG_ERROR', `Invalid API server URL for ctx.k8s.${op}: ${cause.message}`, server, op, { cause })
  }
  const { group, version, resource, namespace } = resourceOptions
  if (!version || !resource) {
    throw new K8sRequestError('K8S_CONFIG_ERROR', `ctx.k8s.${op} needs version and resource`, server, op)
  }
  const segments = group ? ['apis', group, version] : ['api', version]
  if (namespace) segments.push('namespaces', namespace)
  segments.push(resource)
  base.pathname = base.pathname.replace(/\/+$/, '') + '/' + segments.map(encodeURIComponent).join('/')
  base.search = ''
  base.hash = ''
  return base
}

function toK8sRequestError(err: unknown, url: string, op: string, timeoutMs: number | undefined): K8sRequestError {
  if (err instanceof K8sRequestError) return err
  if (err instanceof HttpRequestError) {
    if (err.code === 'HTTP_TIMEOUT_ERROR') {
      return new K8sRequestError('K8S_TIMEOUT_ERROR', `Kubernetes request timed out for ${op} ${url} after ${timeoutMs}ms`, url, op, {
        cause: err,
      })
    }
    return new K8sRequestError('K8S_FETCH_ERROR', `Kubernetes request failed for ${op} ${url}: ${err.message}`, url, op, { cause: err })
  }
  const cause = err instanceof Error ? err : undefined
  const message = err instanceof Error ? err.message : String(err)
  return new K8sRequestError('K8S_FETCH_ERROR', `Kubernetes request failed for ${op} ${url}: ${message}`, url, op, { cause })
}

/** Builds a K8S_API_ERROR from a non-2xx response, using the API server's Status object when it sent one. */
function k8sApiError(response: HttpResponse, url: string, op: string): K8sRequestError {
  let reason: string | null = null
  let detail = ''
  try {
    const status = JSON.parse(response.body) as { reason?: unknown; message?: unknown }
    if (typeof status.reason === 'string') reason = status.reason
    if (typeof status.message === 'string') detail = `: ${status.message}`
  } catch {
    // Not a Status object (an ingress error page, for instance); the HTTP status still tells the story.
  }
  return new K8sRequestError(
    'K8S_API_ERROR',
    `Kubernetes API returned HTTP ${response.status}${reason ? ` ${reason}` : ''} for ${op} ${url}${detail}`,
    url,
    op,
    { status: response.status, reason }
  )
}

async function doK8sFetch(
  url: string,
  k8sOptions: K8sOptions,
  op: K8sCompleteInfo['op'],
  scope: IoScope | undefined
): Promise<HttpResponse> {
  const timeoutMs = resolveTimeoutMs(k8sOptions.timeout, scope)
  const init = k8sRequestInit(k8sOptions)
  // doFetch tracks the call and enforces the timeout; the k8s wrapper reports its own error event.
  const fetchScope = scope && { ...scope, onIoError: undefined }
  try {
    return await doFetch(url, init, { scope: fetchScope, timeoutMs })
  } catch (err) {
    throw toK8sRequestError(err, url, op, timeoutMs)
  }
}

function reportK8sError(scope: IoScope | undefined, err: K8sRequestError, startMs: number): void {
  scope?.onIoError?.({
    protocol: 'k8s',
    op: err.op,
    url: truncateUrl(err.url),
    code: err.code,
    duration_ms: Date.now() - startMs,
    message: err.message,
  })
}

async function doK8sGet(
  url: string,
  k8sOptions: K8sOptions,
  scope: IoScope | undefined,
  onK8sComplete?: BuildCtxOptions['onK8sComplete']
): Promise<HttpResponse> {
  const startMs = Date.now()
  try {
    const response = await doK8sFetch(url, k8sOptions, 'get', scope)
    onK8sComplete?.({ op: 'get', url: truncateUrl(url), status: response.status, duration_ms: Date.now() - startMs })
    return response
  } catch (err) {
    const k8sErr = toK8sRequestError(err, url, 'get', undefined)
    reportK8sError(scope, k8sErr, startMs)
    throw k8sErr
  }
}

async function doK8sList(
  server: string,
  listOptions: K8sListOptions,
  scope: IoScope | undefined,
  onK8sComplete?: BuildCtxOptions['onK8sComplete']
): Promise<K8sListResult> {
  const startMs = Date.now()
  let url = server
  try {
    const target = k8sResourcePath(server, listOptions, 'list')
    const params: string[] = []
    if (listOptions.labelSelector) params.push(`labelSelector=${encodeURIComponent(listOptions.labelSelector)}`)
    if (listOptions.fieldSelector) params.push(`fieldSelector=${encodeURIComponent(listOptions.fieldSelector)}`)
    if (listOptions.limit !== undefined) params.push(`limit=${encodeURIComponent(String(listOptions.limit))}`)
    if (params.length > 0) target.search = `?${params.join('&')}`
    url = target.toString()
    const response = await doK8sFetch(url, listOptions, 'list', scope)
    if (response.status < 200 || response.status >= 300) throw k8sApiError(response, url, 'list')
    const parsed = JSON.parse(response.body) as { items?: unknown; metadata?: { continue?: unknown } }
    const items = Array.isArray(parsed.items) ? (parsed.items as K8sObject[]) : []
    const continueToken = typeof parsed.metadata?.continue === 'string' && parsed.metadata.continue !== '' ? parsed.metadata.continue : null
    onK8sComplete?.({ op: 'list', url: truncateUrl(url), status: response.status, duration_ms: Date.now() - startMs, items: items.length })
    return { items, continue: continueToken }
  } catch (err) {
    const k8sErr = toK8sRequestError(err, url, 'list', undefined)
    reportK8sError(scope, k8sErr, startMs)
    throw k8sErr
  }
}

async function doK8sRead(
  server: string,
  readOptions: K8sReadOptions,
  scope: IoScope | undefined,
  onK8sComplete?: BuildCtxOptions['onK8sComplete']
): Promise<K8sObject> {
  const startMs = Date.now()
  let url = server
  try {
    if (!readOptions.name) throw new K8sRequestError('K8S_CONFIG_ERROR', 'ctx.k8s.read needs a name', server, 'read')
    const target = k8sResourcePath(server, readOptions, 'read')
    target.pathname += `/${encodeURIComponent(readOptions.name)}`
    url = target.toString()
    const response = await doK8sFetch(url, readOptions, 'read', scope)
    if (response.status < 200 || response.status >= 300) throw k8sApiError(response, url, 'read')
    const object = JSON.parse(response.body) as K8sObject
    onK8sComplete?.({ op: 'read', url: truncateUrl(url), status: response.status, duration_ms: Date.now() - startMs })
    return object
  } catch (err) {
    const k8sErr = toK8sRequestError(err, url, 'read', undefined)
    reportK8sError(scope, k8sErr, startMs)
    throw k8sErr
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
  const onK8sComplete = options?.onK8sComplete
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
        const init: RequestInit = { method: 'GET', headers: withSentinelHeaders(httpOptions?.headers) }
        if (httpOptions?.redirect) init.redirect = httpOptions.redirect
        const timeoutMs = resolveTimeoutMs(httpOptions?.timeout, scope)
        return doFetch(url, init, { scope, timeoutMs, onHttpComplete })
      },
      async post(url, body, httpOptions) {
        const init: RequestInit = {
          method: 'POST',
          headers: withSentinelHeaders({ 'content-type': 'application/json', ...httpOptions?.headers }),
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
      async list(url, listOptions) {
        return doS3List(url, listOptions, scope, onS3Complete)
      },
    },
    k8s: {
      async get(url, k8sOptions) {
        return doK8sGet(url, k8sOptions, scope, onK8sComplete)
      },
      async list(server, listOptions) {
        return doK8sList(server, listOptions, scope, onK8sComplete)
      },
      async read(server, readOptions) {
        return doK8sRead(server, readOptions, scope, onK8sComplete)
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
