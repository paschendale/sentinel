import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { BulkTestFieldsShape, IncidentReportShape, IncidentStateSchema, TEST_RESULT_CONTRACT, TestFieldsSchema, UpdateTestSchema, NotificationEventTypeSchema, NotificationChannelFieldsShape } from '@sentinel/shared'
import { RUN_NOW_ERRORS, runNow } from '../executor/run-now.js'

type ToolResult = CallToolResult

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

// Input shapes are advisory for the MCP client — every write is re-validated by the
// route it forwards to, so refined schemas (CreateTestSchema, CreateNotificationChannelSchema)
// are represented here by their unrefined field shapes.
const channelFieldsShape = NotificationChannelFieldsShape

// uses_browser is accepted by the API for compatibility but does nothing; agents never see it.
const { uses_browser: _createUsesBrowser, ...createTestShape } = TestFieldsSchema.shape
const { uses_browser: _updateUsesBrowser, ...updateTestShape } = UpdateTestSchema.shape

const assignmentShape = {
  channel_id: z.string().min(1),
  scope_type: z.enum(['test', 'tag']),
  scope_value: z.string().min(1),
}

function assignmentUrl(scopeType: 'test' | 'tag', scopeValue: string): string {
  return scopeType === 'test'
    ? `/tests/${encodeURIComponent(scopeValue)}/channels`
    : `/tags/${encodeURIComponent(scopeValue)}/channels`
}

export function registerMcpTools(server: McpServer, app: FastifyInstance, authorization: string): void {
  async function forward(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown
  ): Promise<ToolResult> {
    const res = await app.inject({
      method,
      url,
      headers: { authorization },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    })
    const body = res.body || JSON.stringify({ ok: res.statusCode < 400 })
    return textResult(body, res.statusCode >= 400)
  }

  // --- tests ---

  server.registerTool(
    'list_tests',
    { description: 'List all monitoring tests, optionally filtered by tag.', inputSchema: { tag: z.string().optional() } },
    async ({ tag }) => forward('GET', tag ? `/tests?tag=${encodeURIComponent(tag)}` : '/tests')
  )

  server.registerTool(
    'get_test',
    { description: 'Get a single monitoring test by id, including its JS code.', inputSchema: { id: z.string() } },
    async ({ id }) => forward('GET', `/tests/${encodeURIComponent(id)}`)
  )

  server.registerTool(
    'create_test',
    {
      description:
        'Create a monitoring test. code is a JavaScript function body (top-level await allowed) receiving ctx. ' +
        TEST_RESULT_CONTRACT + ' Code that does not compile is rejected with 400. ctx supports four protocols — ctx.http (HTTP/undici), ctx.ftp.ls/get (FTP), ' +
        'ctx.k8s.list/read/get (Kubernetes API reads with a bearer token and optional CA: list(server, ' +
        '{token, ca, group, version, resource, namespace, labelSelector, fieldSelector, limit}) returns ' +
        '{items, continue}, read(server, {..., name}) returns the object, both throw K8S_API_ERROR with ' +
        'status and reason on non-2xx — for CronJob/Job completion, Argo Workflows and Deployment ' +
        'readiness), and ' +
        'ctx.s3.get/head/list (S3-compatible object storage, SigV4-signed; list(bucketUrl, {prefix, ' +
        'delimiter, maxKeys, startAfter, all}) returns {objects:[{key,size,lastModified,etag}], prefixes, ' +
        'truncated} for presence/freshness checks on a prefix) — not just HTTP checks. Also ' +
        'available: ctx.assert(name, value, message?) for named assertions, ctx.warn(message) for a ' +
        'non-fatal warning status, ctx.log(message), ctx.now(), and ctx.secrets.NAME for values created ' +
        'via create_secret. timeout_ms must be at most 80% of schedule_ms. ctx.http/ctx.s3 accept a ' +
        'per-request `timeout` (ms, headers + full body; without it timeout_ms bounds the request) and ' +
        'throw HTTP_TIMEOUT_ERROR / S3_TIMEOUT_ERROR when it is exceeded — set one below timeout_ms on ' +
        'each request so a stalled call fails with its own error instead of timing out the whole run. ' +
        'Requests send a Sentinel User-Agent (plus X-Sentinel-Instance when the deployment names its ' +
        'location); pass your own User-Agent header to override it. ' +
        'retries (0–5) re-runs a failed or timed-out scheduled run and records only the last attempt. ' +
        'Use tags to group related ' +
        'tests — tags drive both the dashboard summary and notification-channel routing.',
      inputSchema: createTestShape,
    },
    async (input) => forward('POST', '/tests', input)
  )

  server.registerTool(
    'update_test',
    {
      description:
        'Update fields of a monitoring test (partial update; set enabled to pause/resume scheduling). ' +
        'Same ctx and timeout semantics as create_test: per-request `timeout` on ctx.http/ctx.s3, ' +
        'retries re-run failed or timed-out scheduled runs.',
      inputSchema: { id: z.string(), ...updateTestShape },
    },
    async ({ id, ...fields }) => forward('PATCH', `/tests/${encodeURIComponent(id)}`, fields)
  )

  server.registerTool(
    'delete_test',
    { description: 'Delete a monitoring test and its run history.', inputSchema: { id: z.string() } },
    async ({ id }) => forward('DELETE', `/tests/${encodeURIComponent(id)}`)
  )

  server.registerTool(
    'bulk_update_tests',
    {
      description:
        'Apply one action to many tests at once (up to 200 ids): enable, disable (pause scheduling), run (start one ' +
        'run of each; results arrive in each test\'s run history), delete, add_tag or remove_tag (tag required). ' +
        'Changes are made in one transaction. Returns one result per id: ok, or an error such as "not found", ' +
        '"test is disabled" or "a run of this test is already in progress". Use list_tests with a tag to collect ids.',
      inputSchema: BulkTestFieldsShape,
    },
    async (input) => forward('POST', '/tests/bulk', input)
  )

  server.registerTool(
    'run_test_now',
    {
      description: 'Execute a test immediately (one attempt, no retries) and return the run result, including buffered ctx.log output. Refused while another run of the same test is in progress.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const logs: string[] = []
      const outcome = await runNow(id, { trigger: 'mcp', onLog: (m) => logs.push(m) })
      if (outcome.kind !== 'ok') return textResult(JSON.stringify({ error: RUN_NOW_ERRORS[outcome.kind].error }), true)
      return textResult(JSON.stringify({ ...outcome.result, logs }))
    }
  )

  server.registerTool(
    'get_test_runs',
    { description: 'Get the last 20 runs of a test, with per-run assertion results.', inputSchema: { id: z.string() } },
    async ({ id }) => forward('GET', `/tests/${encodeURIComponent(id)}/runs`)
  )

  server.registerTool(
    'get_test_incidents',
    {
      description:
        'Get one test\'s incident history as time windows (start, end, duration, failure count, ongoing): failure ' +
        'streaks that crossed its threshold, from stored incidents and the retained runs. For the incidents themselves ' +
        '(timeline, report, other affected tests) use list_incidents / get_incident.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => forward('GET', `/tests/${encodeURIComponent(id)}/incidents`)
  )

  // --- incidents ---

  server.registerTool(
    'list_incidents',
    {
      description:
        'List stored incidents, open first, then newest. Sentinel opens an incident (state investigating) when a test ' +
        'reaches Outage; tests sharing an incident:<group> tag join the same incident (a Degraded test joins an open one ' +
        'but never opens one); it resolves when every linked test is Operational. Each item has severity (down/degraded), ' +
        'state, times, affected tests, published_at (null = internal) and report_state (none/draft/published).',
      inputSchema: { state: z.enum(['open', 'resolved', 'all']).optional() },
    },
    async ({ state }) => forward('GET', state ? `/incidents?state=${state}` : '/incidents')
  )

  server.registerTool(
    'get_incident',
    {
      description: 'Get one incident with its affected tests, full timeline (system entries and notes, internal and public) and report (both versions).',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => forward('GET', `/incidents/${encodeURIComponent(id)}`)
  )

  server.registerTool(
    'add_incident_note',
    {
      description:
        'Add a note to an incident\'s timeline, e.g. what you found or did. Notes from agents are always internal: ' +
        'only a signed-in person can show a note on the status page.',
      inputSchema: { id: z.string(), body: z.string().min(1).max(5000) },
    },
    async ({ id, body }) => forward('POST', `/incidents/${encodeURIComponent(id)}/updates`, { body, public: false })
  )

  server.registerTool(
    'set_incident_state',
    {
      description:
        'Move an incident through investigating → identified → monitoring → resolved (or rename it with title). ' +
        'Sentinel sets investigating and resolved itself; set identified once the cause is known and monitoring once a ' +
        'fix is out. Resolving by hand ends every link; moving a resolved incident back reopens it. Writes a timeline entry.',
      inputSchema: { id: z.string(), state: IncidentStateSchema.optional(), title: z.string().min(1).max(200).optional() },
    },
    async ({ id, ...change }) => forward('PATCH', `/incidents/${encodeURIComponent(id)}`, change)
  )

  server.registerTool(
    'link_incident_test',
    {
      description: 'Link another test to an incident by hand (when it is affected but not in the same incident:<group>).',
      inputSchema: { id: z.string(), test_id: z.string() },
    },
    async ({ id, test_id }) => forward('POST', `/incidents/${encodeURIComponent(id)}/tests`, { test_id })
  )

  server.registerTool(
    'draft_incident_report',
    {
      description:
        'Write or revise the incident report. Five sections — summary, impact, root_cause, resolution, follow_ups — each ' +
        'with an internal and a public version (Markdown: paragraphs, lists, links, inline code). Only the sections and ' +
        'versions you pass are replaced. Public versions must leave out hostnames, pod names, error messages and people. ' +
        'The report stays a draft: only a signed-in person can publish it.',
      inputSchema: { id: z.string(), ...IncidentReportShape },
    },
    async ({ id, ...sections }) => forward('PUT', `/incidents/${encodeURIComponent(id)}/report`, sections)
  )

  // --- overview ---

  server.registerTool(
    'get_dashboard_summary',
    {
      description:
        'Get the dashboard summary for all tests (last status, 7-day pass rate, avg latency), ordered by ' +
        'section: critical (down past its failure threshold), warning (a warning, or failing under the ' +
        'threshold), recovered (passing, but a run in the last 24 h did not pass), clean, disabled. Each ' +
        'test carries its section, problem_started_at / problem_ended_at / problem_worst for the current or ' +
        'last problem, and last_problem_at. Optionally filter by tag and by sections (e.g. ' +
        '["critical","warning"] for what needs attention now).',
      inputSchema: {
        tag: z.string().optional(),
        sections: z.array(z.enum(['critical', 'warning', 'recovered', 'clean', 'disabled'])).optional(),
      },
    },
    async ({ tag, sections }) => {
      const params = new URLSearchParams()
      if (tag) params.set('tag', tag)
      if (sections && sections.length > 0) params.set('section', sections.join(','))
      const qs = params.toString()
      return forward('GET', qs ? `/dashboard?${qs}` : '/dashboard')
    }
  )

  server.registerTool(
    'get_status',
    { description: 'Get the aggregated 30-day public uptime status for all tests.', inputSchema: {} },
    async () => forward('GET', '/status')
  )

  server.registerTool(
    'list_tags',
    { description: 'List all distinct tags used across tests.', inputSchema: {} },
    async () => forward('GET', '/tags')
  )

  // --- notification channels ---

  server.registerTool(
    'list_channels',
    { description: 'List all notification channels (Discord, Slack, webhook, email).', inputSchema: {} },
    async () => forward('GET', '/channels')
  )

  server.registerTool(
    'create_channel',
    {
      description:
        'Create a notification channel. Types: discord, slack, webhook (one message per event, webhook_url required); ' +
        'email (email_to required); discord_bot and slack_bot (bot_token + channel_ref required). Bot channels post one ' +
        'message per incident and keep its history in a thread: the root is edited on state change and on recovery, ' +
        'updates go in the thread, and the thread is archived when the test recovers. bot_token is write-only ' +
        '(responses carry has_bot_token only). channel_ref is the Slack channel ID (C…) or Discord channel ID. ' +
        'After creating a channel, call test_channel to confirm delivery.',
      inputSchema: channelFieldsShape,
    },
    async (input) => forward('POST', '/channels', input)
  )

  server.registerTool(
    'update_channel',
    {
      description: 'Update fields of a notification channel (partial update). Passing bot_token replaces the stored token.',
      inputSchema: { id: z.string(), ...channelFieldsShape },
    },
    async ({ id, ...fields }) => forward('PATCH', `/channels/${encodeURIComponent(id)}`, fields)
  )

  server.registerTool(
    'delete_channel',
    { description: 'Delete a notification channel and its assignments.', inputSchema: { id: z.string() } },
    async ({ id }) => forward('DELETE', `/channels/${encodeURIComponent(id)}`)
  )

  server.registerTool(
    'test_channel',
    {
      description:
        'Send a one-off test message through a notification channel, outside any incident, to confirm the webhook, ' +
        'bot token, channel ID or email address works. Returns ok and the HTTP status.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => forward('POST', `/channels/${encodeURIComponent(id)}/test`)
  )

  server.registerTool(
    'assign_channel',
    {
      description:
        'Assign a notification channel to a test (scope_type "test", scope_value = test id) or to a tag (scope_type "tag"), optionally narrowed to specific event types (fail, warning, recovery).',
      inputSchema: {
        ...assignmentShape,
        event_types: z.array(NotificationEventTypeSchema).min(1).max(3).optional(),
      },
    },
    async ({ channel_id, scope_type, scope_value, event_types }) =>
      forward('POST', assignmentUrl(scope_type, scope_value), {
        channel_id,
        ...(event_types !== undefined ? { event_types } : {}),
      })
  )

  server.registerTool(
    'unassign_channel',
    {
      description: 'Remove a notification channel assignment from a test or tag.',
      inputSchema: assignmentShape,
    },
    async ({ channel_id, scope_type, scope_value }) =>
      forward('DELETE', `${assignmentUrl(scope_type, scope_value)}/${encodeURIComponent(channel_id)}`)
  )

  // --- secrets (write-only: values can never be read back) ---

  server.registerTool(
    'list_secrets',
    {
      description:
        'List secret metadata (name, created/updated timestamps) and whether at-rest encryption is enabled. Secrets are write-only: values can never be read back.',
      inputSchema: {},
    },
    async () => {
      const [list, status] = await Promise.all([
        app.inject({ method: 'GET', url: '/secrets', headers: { authorization } }),
        app.inject({ method: 'GET', url: '/secrets/status', headers: { authorization } }),
      ])
      if (list.statusCode >= 400) return textResult(list.body, true)
      return textResult(JSON.stringify({ secrets: JSON.parse(list.body) as unknown, ...(JSON.parse(status.body) as object) }))
    }
  )

  server.registerTool(
    'create_secret',
    {
      description:
        'Create a secret available to test code as ctx.secrets.NAME. name must be UPPER_SNAKE_CASE. Write-only: the value can never be read back.',
      inputSchema: {
        name: z.string().min(1).max(100).regex(/^[A-Z][A-Z0-9_]*$/),
        value: z.string().min(1),
      },
    },
    async (input) => forward('POST', '/secrets', input)
  )

  server.registerTool(
    'rotate_secret',
    {
      description: 'Replace the value of an existing secret by id. Write-only: neither old nor new value can be read back.',
      inputSchema: { id: z.string(), value: z.string().min(1) },
    },
    async ({ id, value }) => forward('POST', `/secrets/${encodeURIComponent(id)}/rotate`, { value })
  )

  server.registerTool(
    'delete_secret',
    { description: 'Delete a secret by id. Tests referencing it will see ctx.secrets.NAME as undefined.', inputSchema: { id: z.string() } },
    async ({ id }) => forward('DELETE', `/secrets/${encodeURIComponent(id)}`)
  )
}
