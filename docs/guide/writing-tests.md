# Writing tests

A test is the body of a JavaScript function. Sentinel calls it on a schedule with one argument, `ctx`, and records the outcome as a run. This page is the single reference for `ctx`; the MCP server's instructions are a condensed copy of it.

- What a test's state means, and how runs become incidents: [Status and incidents](./status-and-incidents.md)
- Where alerts go: [Notifications](./notifications.md)
- Creating tests over HTTP or MCP: [API reference](../reference/api.md)

## The contract

Throw, fail a `ctx.assert`, or return `false` to fail the run. Returning `true`, nothing or any other value passes. `ctx.warn` marks a passing run as Warned.

| Run result | Wire value | When |
| --- | --- | --- |
| Passed | `success` | The function returned anything other than exactly `false`, and did not warn |
| Warned | `warn` | It passed, but called `ctx.warn()` at least once |
| Failed | `fail` | It threw (a failed `ctx.assert` throws), or returned exactly `false` (message `returned false`) |
| Timed out | `timeout` | It ran longer than `timeout_ms` |

Only exactly `false` fails. `0`, `''`, `null` and `undefined` pass. A test written as `return res.status === 200` therefore fails whenever the comparison is false; before this rule the return value was ignored, so review such tests when upgrading.

A Warned run is not a failure: it resets the failure streak and makes the test Degraded. Failed and Timed out runs count toward the failure threshold; once the streak reaches it the test is in Outage. See [Status and incidents](./status-and-incidents.md).

User code gets only `ctx`: no `require`, no `import`, no `process`, no file system. Top-level `await` works.

## Fields

| Field | Rule | Default |
| --- | --- | --- |
| `name` | Free text | required |
| `code` | Function body. Compiled on save; code that does not compile is rejected with `400` and `code does not compile: <error>` | required |
| `schedule_ms` | Interval between runs, at least `30000` | required (the editor suggests 1 min) |
| `timeout_ms` | At least `1000`, at most 80% of `schedule_ms`, so a slow run never overlaps the next one | `5000` |
| `retries` | `0` to `5`. Extra attempts for a scheduled run that fails or times out; see [Retries](#retries) | `0` |
| `failure_threshold` | Failed runs in a row before the test is in Outage and alerts | `3` |
| `cooldown_ms` | Minimum time between repeated alerts of the same kind | `86400000` (24 h) |
| `tags` | Up to 20 free-form tags. They drive status pages, alert routing and incident grouping (`incident:<group>`) | `[]` |
| `enabled` | `false` pauses the test: it is not scheduled and shows as Paused | `true` |

If stored code does not compile (saved before compile-on-save existed), each run records a Failed run with `code does not compile: <error>` instead of being skipped silently.

## `ctx` at a glance

| Member | Does |
| --- | --- |
| `ctx.http.get` / `ctx.http.post` | HTTP requests through undici |
| `ctx.ftp.ls` / `ctx.ftp.get` | FTP and FTPS listings and downloads |
| `ctx.s3.get` / `ctx.s3.head` / `ctx.s3.list` | S3-compatible object storage, SigV4-signed |
| `ctx.k8s.list` / `ctx.k8s.read` / `ctx.k8s.get` | Read-only Kubernetes API requests |
| `ctx.secrets.NAME` | Values from the secret store |
| `ctx.assert(name, value, message?)` | Named assertion; throws when `value` is falsy |
| `ctx.warn(message)` | Marks the run Warned without failing it |
| `ctx.log(message)` | Writes to the run log |
| `ctx.now()` | The current time as a `Date` |

## `ctx.http`

```js
const res = await ctx.http.get('https://example.com/api/health')
// res.status       number
// res.headers      object
// res.body         string
// res.json()       parsed body (throws if it is not JSON)
// res.duration_ms  request time

const created = await ctx.http.post('https://example.com/api/users', { name: 'Test user' })
```

`ctx.http` has two methods: `get(url, options?)` and `post(url, body, options?)`. `post` sends `body` as JSON with `content-type: application/json` (a header you pass overrides it). Both return `{ status, headers, body, json(), duration_ms }` and do not throw on a non-2xx status: check `res.status` yourself.

Options:

- `headers`: request headers.
- `timeout`: request limit in milliseconds, covering the response headers and the full body. Over it the call throws `HTTP_TIMEOUT_ERROR`, saying whether headers arrived and how much of the body was read. A non-positive value throws `TypeError`. Without it, the test's `timeout_ms` bounds the request.
- `redirect`: `'follow'` (default), `'manual'` or `'error'`.

Some web front ends bounce between redirects. To treat a redirect as reachable, use `redirect: 'manual'`:

```js
const res = await ctx.http.get('https://example.com/app/', { redirect: 'manual' })
ctx.assert('reachable', res.status >= 200 && res.status < 400)
```

Errors (`HttpRequestError`, with `code`): `HTTP_FETCH_ERROR` (the request failed), `HTTP_REDIRECT_ERROR` (redirect loop or limit with `'follow'`), `HTTP_TIMEOUT_ERROR`, `HTTP_SIZE_LIMIT_ERROR` (see [Size limit](#size-limit)).

## `ctx.ftp`

```js
const entries = await ctx.ftp.ls('ftp://user:pass@ftp.example.com/incoming')
ctx.assert('has files', entries.length > 0)

const file = await ctx.ftp.get('ftp://user:pass@ftp.example.com/incoming/daily.csv')
// file.body  string (utf-8)
// file.size  bytes
ctx.assert('file not empty', file.size > 0)
```

- `ctx.ftp.ls(url, options?)` returns `{ name, type, size, modifiedAt }[]` for the directory at `url`; `type` is `'file'`, `'directory'` or `'unknown'`.
- `ctx.ftp.get(url, options?)` downloads a file and returns `{ body, size }`.

`url` is `ftp://[user:pass@]host[:port]/path`. Options: `user` / `password` (override the URL; defaults `anonymous` / `guest`), `secure` (FTPS with explicit TLS, default `false`), `timeout` (socket timeout in ms, default the test's `timeout_ms`).

Downloads are never kept. `get` streams into a temp file under `FTP_TEMP_DIR`, reads it into `body` and deletes it before returning; a sweep removes any leftover file older than `FTP_TEMP_MAX_AGE_MS` (default 15 min). Your code only sees the string.

Errors (`FtpRequestError`): `FTP_CONNECT_ERROR`, `FTP_LIST_ERROR`, `FTP_DOWNLOAD_ERROR`, `FTP_SIZE_LIMIT_ERROR`.

## `ctx.s3`

```js
const auth = {
  accessKey: ctx.secrets.S3_ACCESS_KEY,
  secretKey: ctx.secrets.S3_SECRET_KEY,
  region: 'us-east-1',
}

const res = await ctx.s3.get('https://examplebucket.s3.us-east-1.amazonaws.com/test.txt', auth)
ctx.assert('object exists', res.status === 200)

const head = await ctx.s3.head('https://examplebucket.s3.us-east-1.amazonaws.com/test.txt', auth)
ctx.assert('metadata reachable', head.status === 200)

// At least one object written under today's prefix in the last 6 h
const listing = await ctx.s3.list('https://examplebucket.s3.us-east-1.amazonaws.com/', {
  ...auth,
  prefix: `exports/${ctx.now().toISOString().slice(0, 10)}/`,
  all: true,
})
const fresh = listing.objects.filter((o) => o.lastModified && ctx.now() - o.lastModified < 6 * 3600 * 1000)
ctx.assert('export written in the last 6 h', fresh.length > 0, `${listing.objects.length} objects, none fresh`)
```

Requests are signed with AWS Signature Version 4 (implemented with `node:crypto`, no AWS SDK). Any S3-compatible endpoint works: virtual-hosted style, path style, MinIO, R2 and others, because signing depends only on the URL.

- `ctx.s3.get(url, options)` downloads an object. Like `ctx.ftp.get`, it goes through a temp file in `FTP_TEMP_DIR` that is deleted before the call returns.
- `ctx.s3.head(url, options)` checks existence and metadata without a body.
- Both return the same `{ status, headers, body, json(), duration_ms }` as `ctx.http`, without a status check.
- `ctx.s3.list(bucketUrl, options)` lists objects (ListObjectsV2). `bucketUrl` is the bucket endpoint; the key filter goes in the options. It returns `{ objects, prefixes, truncated }`, each object `{ key, size, lastModified, etag, storageClass }`. One page (up to 1000 keys) by default; `all: true` follows continuation tokens up to 10 000 keys. `truncated` says more keys exist than were returned. A non-2xx response throws `S3_LIST_ERROR` with the service's error code (for example `HTTP 403 AccessDenied`), so a bad key never reads as "no objects".

Options: `accessKey`, `secretKey`, `region` (required, must match the bucket), `sessionToken` (temporary credentials), `headers` (signed, for example `Range: bytes=0-9`), `timeout` (same rule as `ctx.http`; for `list`, per page). `list` also takes `prefix`, `delimiter` (groups come back in `prefixes`), `maxKeys` (1 to 1000 per page), `startAfter` and `all`.

Errors (`S3RequestError`): `S3_SIGNING_ERROR` (malformed URL, before any request), `S3_FETCH_ERROR`, `S3_TIMEOUT_ERROR`, `S3_LIST_ERROR`, `S3_SIZE_LIMIT_ERROR`.

Keep the keys in [secrets](#ctxsecrets), as above.

### Trying `ctx.s3` locally

S3 rejects invalid signatures even on public objects, so there is no anonymous public server to try against. A throwaway MinIO container works:

```bash
docker run -d --name sentinel-demo-minio -p 19000:9000 -p 19001:9001 \
  -e MINIO_ROOT_USER=demoaccesskey \
  -e MINIO_ROOT_PASSWORD=demosecretkey123 \
  minio/minio server /data --console-address ":9001"

AWS_ACCESS_KEY_ID=demoaccesskey AWS_SECRET_ACCESS_KEY=demosecretkey123 \
  aws --endpoint-url http://localhost:19000 --region us-east-1 s3 mb s3://sentinel-demo
echo "hello from ctx.s3" | \
  AWS_ACCESS_KEY_ID=demoaccesskey AWS_SECRET_ACCESS_KEY=demosecretkey123 \
  aws --endpoint-url http://localhost:19000 --region us-east-1 s3 cp - s3://sentinel-demo/hello.txt
```

Store `demoaccesskey` / `demosecretkey123` as the `S3_ACCESS_KEY` / `S3_SECRET_KEY` secrets and use `http://localhost:19000/sentinel-demo/hello.txt`. Remove it with `docker rm -f sentinel-demo-minio`.

## `ctx.k8s`

```js
const server = 'https://cluster.example.com:6443'
const auth = { token: ctx.secrets.K8S_TOKEN, ca: ctx.secrets.K8S_CA }

// Did the nightly CronJob succeed in the last 26 h?
const job = await ctx.k8s.read(server, { ...auth, group: 'batch', version: 'v1', resource: 'cronjobs', namespace: 'jobs', name: 'nightly-export' })
const lastSuccess = job.status?.lastSuccessfulTime ? new Date(job.status.lastSuccessfulTime) : null
ctx.assert('nightly-export succeeded recently', lastSuccess && ctx.now() - lastSuccess < 26 * 3600 * 1000, `last success: ${lastSuccess}`)

// Are all Deployments in a namespace ready?
const { items } = await ctx.k8s.list(server, { ...auth, group: 'apps', version: 'v1', resource: 'deployments', namespace: 'web' })
const notReady = items.filter((d) => (d.status?.readyReplicas ?? 0) < (d.spec?.replicas ?? 0)).map((d) => d.metadata.name)
ctx.assert('all deployments ready', notReady.length === 0, `not ready: ${notReady.join(', ')}`)

// Did the latest Argo Workflow of a CronWorkflow finish?
const runs = await ctx.k8s.list(server, { ...auth, group: 'argoproj.io', version: 'v1alpha1', resource: 'workflows', namespace: 'argo', labelSelector: 'workflows.argoproj.io/cron-workflow=hourly-job' })
const latest = runs.items.sort((a, b) => b.metadata.creationTimestamp.localeCompare(a.metadata.creationTimestamp))[0]
ctx.assert('latest hourly-job run succeeded', latest?.status?.phase === 'Succeeded', `phase: ${latest?.status?.phase}`)
```

`ctx.k8s` reads from a Kubernetes API server with a bearer token, so a test can check CronJob and Job completion, custom resources such as Argo Workflows, and Deployment readiness without anything running in the cluster. It only issues GETs.

- `ctx.k8s.list(server, options)` returns `{ items, continue }`; `continue` is set when `limit` cut the list short.
- `ctx.k8s.read(server, options)` reads one object by `name`.
- `ctx.k8s.get(url, options)` is the raw form: any API path, the `ctx.http` response shape, no status check.

Options on every call: `token` (required), `ca` (PEM bundle the server certificate must chain to; otherwise the system trust store), `headers`, `timeout`. `list` and `read` take `group` (omit for the core group), `version`, `resource` (plural) and `namespace` (omit for cluster-scoped resources or all namespaces). `list` also takes `labelSelector`, `fieldSelector` and `limit`; `read` takes `name`.

Errors (`K8sRequestError`): `K8S_API_ERROR` on any non-2xx from `list` or `read`, with `status` and the API server's `reason` (`NotFound`, `Forbidden`, …), so a missing object or a revoked token never reads as zero items; `K8S_CONFIG_ERROR` (empty token, bad URL, missing coordinates; before any request); `K8S_FETCH_ERROR`; `K8S_TIMEOUT_ERROR`; `K8S_SIZE_LIMIT_ERROR`.

A minimal read-only identity:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata: { name: sentinel-reader, namespace: monitoring }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata: { name: sentinel-reader }
rules:
  - apiGroups: ["", "apps", "batch"]
    resources: ["pods", "namespaces", "deployments", "cronjobs", "jobs"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata: { name: sentinel-reader }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: sentinel-reader }
subjects: [{ kind: ServiceAccount, name: sentinel-reader, namespace: monitoring }]
---
apiVersion: v1
kind: Secret
metadata:
  name: sentinel-reader-token
  namespace: monitoring
  annotations: { kubernetes.io/service-account.name: sentinel-reader }
type: kubernetes.io/service-account-token
```

Store `data.token` (base64-decoded) as the token secret and `data.ca\.crt` as the CA secret. For Argo checks, add `argoproj.io` with `workflows` and `cronworkflows` to the rules.

## `ctx.secrets`

```js
const res = await ctx.http.get('https://api.example.com/health', {
  headers: { Authorization: `Bearer ${ctx.secrets.API_KEY}` },
})
ctx.assert('authenticated', res.status === 200)
```

`ctx.secrets` is a frozen plain object mapping every secret name to its value. A missing name, or a secret that could not be decrypted, is `undefined`. Secrets are global: every test can read every secret. Values are write-only through the API; create, rotate and delete them on the Secrets page (`/admin/secrets`), with `POST /secrets` or with the MCP tool `create_secret`. Names are `UPPER_SNAKE_CASE`.

## `ctx.assert(name, value, message?)`

```js
ctx.assert('status is 200', res.status === 200)
ctx.assert('body has id', res.json().id !== undefined, 'expected id in response')
```

Records a named assertion on the run and throws when `value` is falsy, failing the run. `message` is stored with a failed assertion. Assertions show on the test page and in `GET /tests/:id/runs`.

## `ctx.warn(message)`

```js
if (ageMinutes >= 180) throw new Error(`stale for ${Math.round(ageMinutes)} min`)
if (ageMinutes >= 60) ctx.warn(`stale for ${Math.round(ageMinutes)} min`)
```

Records a warning and does not throw. If the run otherwise passes it is Warned, its `error_message` holds the warnings joined by `; `, and the test becomes Degraded. The failure streak resets, and a Degraded alert goes out (see [Notifications](./notifications.md)). Useful for soft thresholds and freshness checks.

## `ctx.log(message)` and `ctx.now()`

`ctx.log` writes to the run log; it has no effect on the result. The log streams to the browser during "Run now" and comes back from the MCP tool `run_test_now`. `ctx.now()` returns the current time as a `Date`.

## Limits and timeouts

### Size limit

Response bodies are capped at `FTP_MAX_DOWNLOAD_BYTES` (default 5 MB). The cap applies to `ctx.http`, `ctx.k8s`, `ctx.s3.list`, `ctx.s3.get` and `ctx.ftp.get`; a body over it aborts the transfer and throws `HTTP_SIZE_LIMIT_ERROR`, `K8S_SIZE_LIMIT_ERROR`, `S3_SIZE_LIMIT_ERROR` or `FTP_SIZE_LIMIT_ERROR`.

### Timeouts

Give each request its own `timeout`, below `timeout_ms`, so a stalled call fails with its own error instead of timing out the whole run. When the run reaches `timeout_ms`:

- every pending `ctx.http`, `ctx.s3`, `ctx.k8s` and `ctx.ftp` call is aborted (FTP by closing the connection), and later calls from the same run fail at once;
- the run is Timed out, with `error_message` `Timed out after <ms>ms; in flight: GET <url> (41.2s, headers received, 180.0 KB of body read)` naming each pending call.

### Retries

With `retries` above 0, a scheduled run that fails or times out is tried again, up to that many times, as long as a full `timeout_ms` attempt still fits within 80% of `schedule_ms` from the first attempt. Only the last attempt is recorded: a pass on retry is Passed, and when every attempt fails the message ends with `[all <n> attempts failed]`. "Run now", the run stream and `run_test_now` make one attempt.

## Outbound identification

Every `ctx.http`, `ctx.s3` and `ctx.k8s` request sends `User-Agent: Sentinel (+https://github.com/territorial-dev/sentinel)`. When the deployment sets `SENTINEL_INSTANCE` (for example `sao-paulo-1`), the User-Agent becomes `Sentinel (+https://github.com/territorial-dev/sentinel; instance=sao-paulo-1)` and an `X-Sentinel-Instance: sao-paulo-1` header is added, so a monitored server can tell which location probed it. A `User-Agent` you set in `headers` (any case) wins. For `ctx.s3` these headers are outside the signature. FTP has no headers.

## Examples

Uptime:

```js
const res = await ctx.http.get('https://example.com')
return res.status === 200
```

JSON API:

```js
const res = await ctx.http.get('https://api.example.com/health', { timeout: 3000 })
ctx.assert('status ok', res.status === 200)
ctx.assert('service reports ok', res.json().status === 'ok')
```

Several steps:

```js
const create = await ctx.http.post('https://api.example.com/users', { name: 'Test user' })
ctx.assert('user created', create.status === 201)

const { id } = create.json()
const read = await ctx.http.get(`https://api.example.com/users/${id}`)
ctx.assert('user exists', read.status === 200)
ctx.assert('name matches', read.json().name === 'Test user')
```

FTP, against [test.rebex.net](https://test.rebex.net), a public read-only server for trying FTP clients:

```js
const entries = await ctx.ftp.ls('ftp://demo:password@test.rebex.net/')
for (const e of entries) ctx.log(`${e.type} ${e.name} (${e.size} bytes)`)
ctx.assert('has entries', entries.length > 0)

const file = await ctx.ftp.get('ftp://demo:password@test.rebex.net/readme.txt')
ctx.assert('file not empty', file.size > 0)
```

Expecting an error:

```js
let caught = null
try {
  await ctx.ftp.get('ftp://demo:password@test.rebex.net/does-not-exist.txt')
} catch (err) {
  caught = err
}
ctx.assert('error code is FTP_DOWNLOAD_ERROR', caught?.code === 'FTP_DOWNLOAD_ERROR')
```

## Type reference

```typescript
interface TestContext {
  http: {
    get(url: string, options?: RequestOptions): Promise<HttpResponse>
    post(url: string, body: unknown, options?: RequestOptions): Promise<HttpResponse>
  }
  ftp: {
    ls(url: string, options?: FtpOptions): Promise<FtpEntry[]>
    get(url: string, options?: FtpOptions): Promise<FtpDownloadResult>
  }
  s3: {
    get(url: string, options: S3Options): Promise<HttpResponse>
    head(url: string, options: S3Options): Promise<HttpResponse>
    list(bucketUrl: string, options: S3ListOptions): Promise<S3ListResult>
  }
  k8s: {
    get(url: string, options: K8sOptions): Promise<HttpResponse>          // raw GET, no status check
    list(server: string, options: K8sListOptions): Promise<K8sListResult>  // throws K8S_API_ERROR on non-2xx
    read(server: string, options: K8sReadOptions): Promise<K8sObject>      // throws K8S_API_ERROR on non-2xx (404 included)
  }
  assert: (name: string, value: unknown, message?: string) => void
  warn: (message: string) => void
  log: (message: string) => void
  now: () => Date
  secrets: Readonly<Record<string, string>>
}

interface HttpResponse {
  status: number
  headers: Record<string, string>
  body: string
  json<T = unknown>(): T
  duration_ms: number
}

interface RequestOptions {
  headers?: Record<string, string>
  timeout?: number   // ms, headers and full body; without it the run's timeout_ms bounds the request
  redirect?: 'follow' | 'manual' | 'error'
}

interface FtpEntry { name: string; type: 'file' | 'directory' | 'unknown'; size: number; modifiedAt: Date | null }
interface FtpDownloadResult { body: string; size: number }
interface FtpOptions {
  user?: string
  password?: string
  secure?: boolean   // FTPS (explicit TLS), default false
  timeout?: number   // socket timeout, ms
}

interface S3Options {
  accessKey: string
  secretKey: string
  region: string
  sessionToken?: string
  headers?: Record<string, string>  // included in the signature
  timeout?: number
}
interface S3ListOptions extends S3Options {
  prefix?: string
  delimiter?: string
  maxKeys?: number     // 1..1000 per page
  startAfter?: string
  all?: boolean        // follow continuation tokens, up to 10 000 keys
}
interface S3Object { key: string; size: number; lastModified: Date | null; etag: string | null; storageClass: string | null }
interface S3ListResult { objects: S3Object[]; prefixes: string[]; truncated: boolean }

interface K8sOptions {
  token: string
  ca?: string                       // PEM bundle; system trust store otherwise
  headers?: Record<string, string>
  timeout?: number
}
interface K8sResourceOptions extends K8sOptions {
  group?: string      // omit for the core group (/api/v1)
  version: string
  resource: string    // plural, e.g. 'cronjobs'
  namespace?: string  // omit for cluster-scoped resources or an all-namespaces list
}
interface K8sListOptions extends K8sResourceOptions { labelSelector?: string; fieldSelector?: string; limit?: number }
interface K8sReadOptions extends K8sResourceOptions { name: string }
type K8sObject = Record<string, unknown>
interface K8sListResult { items: K8sObject[]; continue: string | null }
```
