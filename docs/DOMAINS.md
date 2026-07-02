# Sentinel — Domain Model

## Entities

### Test
The central entity. Represents a user-defined monitoring check.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (nanoid) | Unique identifier |
| `name` | `string` | Human-readable label |
| `code` | `string` | JavaScript function body — must return boolean |
| `schedule_ms` | `number` | Run interval in milliseconds (minimum: 30,000) |
| `timeout_ms` | `number` | Max execution time per run (minimum: 1,000; must be ≤ 80% of `schedule_ms`) |
| `retries` | `number` | Reserved retry budget per check (currently not applied by executor; each scheduled run records a single final outcome) |
| `uses_browser` | `boolean` | Whether this test uses Playwright (opt-in, default false) |
| `enabled` | `boolean` | Whether the scheduler should run this test |
| `created_at` | `timestamp` | Creation time |
| `updated_at` | `timestamp` | Last modification time |

**Invariants:**
- `schedule_ms >= 30000` — minimum 30-second interval
- `timeout_ms >= 1000` and `timeout_ms <= schedule_ms * 0.8` — no flat cap, but a run's timeout budget may never approach its own interval, so the scheduler can't end up with two overlapping runs of the same test (enforced in the Zod schema on create, and as a Postgres `CHECK` constraint on both create and update — see `apps/api/src/scheduler/index.ts` for the runtime overlap guard that backs this up)
- `code` must compile without error before saving
- `code` must be a function body that returns a boolean

---

### TestRun
A single execution result for a test.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (nanoid) | Unique identifier |
| `test_id` | `string` | FK → Test |
| `started_at` | `timestamp` | Execution start time |
| `finished_at` | `timestamp` | Execution end time |
| `status` | `'success' \| 'warn' \| 'fail' \| 'timeout'` | Outcome |
| `duration_ms` | `number` | Wall-clock execution duration |
| `error_message` | `string \| null` | Error/warning details if status is warn, fail, or timeout |

**Invariants:**
- `finished_at >= started_at`
- `status = 'warn'` when the test called `ctx.warn()` without throwing — `error_message` holds the joined warning messages
- `status = 'timeout'` when execution exceeded `test.timeout_ms`
- Raw runs are retained for 7 days by default (`RAW_RETENTION_DAYS`) and pruned daily by timestamp cutoff in batches

---

### AssertionResult
An individual named assertion within a test run. Optional — only recorded when user code calls `ctx.assert()`.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (nanoid) | Unique identifier |
| `test_run_id` | `string` | FK → TestRun |
| `test_run_started_at` | `timestamp` | Partition key companion for FK → TestRun |
| `name` | `string` | Assertion label (e.g., "status is 200") |
| `passed` | `boolean` | Whether the assertion passed |
| `message` | `string \| null` | Failure reason or additional context |

**Invariants:**
- `(test_run_id, test_run_started_at)` references `TestRun(id, started_at)` with `ON DELETE CASCADE`
- Assertion rows are pruned automatically when retained raw runs are deleted

---

### UptimeDaily
Pre-aggregated daily stats per test. The only table queried by public dashboards.

| Field | Type | Description |
|-------|------|-------------|
| `test_id` | `string` | FK → Test |
| `date` | `date` (YYYY-MM-DD) | The day this row covers |
| `success_count` | `number` | Successful runs that day |
| `failure_count` | `number` | Failed + timeout runs that day |
| `avg_latency_ms` | `number` | Average duration across all runs that day |

**Invariants:**
- One row per (test_id, date) — upserted at end of day
- Retained for 30–180 days via config (`AGG_RETENTION_DAYS`, default 90)
- Never queried alongside raw `test_runs` — used exclusively for history/dashboard

---

### Secret
A named, encrypted-at-rest value referenced in test code as `ctx.secrets.NAME`. Global — not scoped to a `Test`, no relationship to any other entity.

| Field | Type | Description |
|-------|------|--------------|
| `id` | `string` (nanoid) | Unique identifier |
| `name` | `string` | `UPPER_SNAKE_CASE` — this is the literal `ctx.secrets` property key |
| `value_blob` | `bytea` | Version-tagged blob: AES-256-GCM ciphertext if `SECRETS_ENCRYPTION_KEY` was set at write time, plaintext otherwise. Never exposed via the API or shared types |
| `created_at` | `timestamp` | Creation time |
| `updated_at` | `timestamp` | Last rotation time |

**Invariants:**
- `name` is `UNIQUE` and must match `^[A-Z][A-Z0-9_]*$` (enforced by both a Zod schema and a Postgres `CHECK` constraint)
- **Write-only**: no API response ever includes the decrypted value or `value_blob` after creation — only `create` (initial value), `rotate` (replace value), `delete`, and `list`/`status` (metadata only) are exposed
- `name` is immutable — renaming would silently break any test code referencing `ctx.secrets.NAME`; changing a value means rotating it, not editing the row
- Encryption is optional: if `SECRETS_ENCRYPTION_KEY` is unset when a secret is created or rotated, its `value_blob` stays in plaintext (mode-tagged) form; encrypted and plaintext secrets can coexist in the table
- A secret whose `value_blob` can't be decrypted by the running process (e.g. the key was changed or removed after that secret was encrypted) is logged and excluded from `ctx.secrets` rather than crashing the process — see `apps/api/src/db/queries/secrets.ts`

---

### NotificationChannel
A delivery target for alerts related to a test.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (nanoid) | Unique identifier |
| `test_id` | `string` | FK → Test |
| `type` | `'discord' \| 'slack' \| 'webhook'` | Channel type |
| `webhook_url` | `string` | Target URL for the notification |
| `enabled` | `boolean` | Whether this channel is active |

**Invariants:**
- `webhook_url` must be a valid HTTPS URL
- Multiple channels can exist per test

---

### TestState
Runtime state for each test. Tracks alert logic. Persisted to DB but treated as a live cache in memory.

| Field | Type | Description |
|-------|------|-------------|
| `test_id` | `string` | FK → Test (PK) |
| `last_status` | `'success' \| 'warn' \| 'fail' \| 'timeout' \| null` | Status of the most recent run |
| `consecutive_failures` | `number` | Unbroken streak of non-success, non-warn results |
| `last_notification_at` | `timestamp \| null` | When the last fail/recovery alert was fired |
| `last_warning_at` | `timestamp \| null` | When the last warning alert was fired |
| `last_run_at` | `timestamp \| null` | When the test last executed |

**Invariants:**
- `consecutive_failures` resets to 0 on `success` or `warn` (neither is a failure streak)
- A **fail** notification fires when `consecutive_failures >= threshold` AND `now - last_notification_at > cooldown`
- A **warning** notification fires on the first `warn` result (no threshold), then after `cooldown` elapses — tracked independently via `last_warning_at` so it never blocks a subsequent fail alert
- A **recovery** notification fires on `success` if either `last_notification_at` or `last_warning_at` is set; both are cleared on recovery

---

## Relationships

```
Test (1) ──────────────────────→ (M) TestRun
Test (1) ──────────────────────→ (M) NotificationChannel
Test (1) ──────────────────────→ (1) TestState
Test (1) ──────────────────────→ (M) UptimeDaily
TestRun (1) ───────────────────→ (M) AssertionResult

Secret is global and unrelated to any other entity — every Test can read every
Secret via ctx.secrets, there is no join table.
```

---

## `ctx` API (Test Execution Context)

The object passed to user test functions. This is the only interface user code has with the outside world.

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
  assert: (name: string, value: boolean, message?: string) => void
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
  timeout?: number
  redirect?: 'follow' | 'manual' | 'error'
}

interface FtpEntry {
  name: string
  type: 'file' | 'directory' | 'unknown'
  size: number
  modifiedAt: Date | null
}

interface FtpDownloadResult {
  body: string
  size: number
}

interface FtpOptions {
  user?: string
  password?: string
  secure?: boolean   // FTPS (explicit TLS), default false
  timeout?: number    // per-connection socket timeout, ms
}
```

**Method behaviour:**
- `ctx.assert(name, value, message?)` — records a named assertion; throws immediately on failure, failing the run
- `ctx.warn(message)` — records a warning message and emits it to the run log; does **not** throw; if any warns were recorded when the test returns, status becomes `'warn'` and `error_message` holds all messages joined by `'; '`
- `ctx.log(message)` — emits a message to the run log; has no effect on status
- `ctx.http` routes through undici with the test's timeout enforced
- `ctx.ftp.ls`/`ctx.ftp.get` route through `basic-ftp`; `url` is a full `ftp://[user:pass@]host[:port]/path`. `get` downloads to a server-managed temp file (`FTP_TEMP_DIR`), reads it into `body`, and deletes it before returning — the file never outlives the call. Downloads are capped by `FTP_MAX_DOWNLOAD_BYTES` (default 5MB) and aborted if exceeded. A periodic sweep job deletes any orphaned temp file older than `FTP_TEMP_MAX_AGE_MS` as a backstop for crash/timeout edge cases. User code never sees a file path — only the returned string body.
- `ctx.secrets` is a plain, frozen object (not a getter/method) mapping every `Secret.name` to its decrypted value — accessing a name that doesn't exist yields `undefined`, same as any missing object property; it never throws. It's backed by an in-memory cache (`apps/api/src/executor/secrets-cache.ts`) decrypted once at process startup and refreshed synchronously on every secret create/rotate/delete, so building `ctx` never queries the database or does crypto on the test-execution hot path.
- No `ctx.fs`, no `ctx.exec`, no `require()`, no `import`
