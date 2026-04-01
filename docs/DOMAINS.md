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
| `timeout_ms` | `number` | Max execution time per run (maximum: 10,000) |
| `retries` | `number` | Number of retries on failure before recording as failed (default: 0) |
| `uses_browser` | `boolean` | Whether this test uses Playwright (opt-in, default false) |
| `enabled` | `boolean` | Whether the scheduler should run this test |
| `created_at` | `timestamp` | Creation time |
| `updated_at` | `timestamp` | Last modification time |

**Invariants:**
- `schedule_ms >= 30000` — minimum 30-second interval
- `timeout_ms <= 10000` — hard cap at 10 seconds
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
| `status` | `'success' \| 'fail' \| 'timeout'` | Outcome |
| `duration_ms` | `number` | Wall-clock execution duration |
| `error_message` | `string \| null` | Error details if status is fail or timeout |

**Invariants:**
- `finished_at >= started_at`
- `status = 'timeout'` when execution exceeded `test.timeout_ms`
- Raw runs are retained for 7 days, then pruned via partition drop

---

### AssertionResult
An individual named assertion within a test run. Optional — only recorded when user code calls `ctx.assert()`.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (nanoid) | Unique identifier |
| `test_run_id` | `string` | FK → TestRun |
| `name` | `string` | Assertion label (e.g., "status is 200") |
| `passed` | `boolean` | Whether the assertion passed |
| `message` | `string \| null` | Failure reason or additional context |

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
- Retained for 30–90 days (configurable)
- Never queried alongside raw `test_runs` — used exclusively for history/dashboard

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
| `last_status` | `'success' \| 'fail' \| 'timeout' \| null` | Status of the most recent run |
| `consecutive_failures` | `number` | Unbroken streak of non-success results |
| `last_notification_at` | `timestamp \| null` | When the last alert was fired |
| `last_run_at` | `timestamp \| null` | When the test last executed |

**Invariants:**
- `consecutive_failures` resets to 0 on any success
- A notification fires only when `consecutive_failures >= threshold` AND `now - last_notification_at > cooldown`
- A notification fires on recovery (fail→success) with no threshold requirement

---

## Relationships

```
Test (1) ──────────────────────→ (M) TestRun
Test (1) ──────────────────────→ (M) NotificationChannel
Test (1) ──────────────────────→ (1) TestState
Test (1) ──────────────────────→ (M) UptimeDaily
TestRun (1) ───────────────────→ (M) AssertionResult
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
  assert: {
    (name: string, value: boolean, message?: string): void  // V2
  }
  log: (message: string) => void
  now: () => Date
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
```

**Restrictions:**
- `ctx.http` routes through undici with the test's timeout enforced
- No `ctx.fs`, no `ctx.exec`, no `require()`, no `import`
- `ctx.log` output is captured per-run and stored in `TestRun.error_message` on failure
