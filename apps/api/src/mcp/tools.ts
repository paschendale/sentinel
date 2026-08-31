import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Test } from '@sentinel/shared'
import { TestFieldsSchema, UpdateTestSchema, NotificationEventTypeSchema } from '@sentinel/shared'
import { runTest } from '../executor/run.js'
import { enqueue } from '../db/result-buffer.js'

type ToolResult = CallToolResult

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

// Input shapes are advisory for the MCP client — every write is re-validated by the
// route it forwards to, so refined schemas (CreateTestSchema, CreateNotificationChannelSchema)
// are represented here by their unrefined field shapes.
const channelFieldsShape = {
  name: z.string().min(1).max(100),
  type: z.enum(['discord', 'slack', 'webhook', 'email']),
  webhook_url: z.string().url().optional(),
  email_to: z.array(z.string().email()).min(1).max(10).optional(),
  enabled: z.boolean().optional(),
}

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
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
        'Create a monitoring test. code is a JavaScript function body receiving ctx and must return a ' +
        'boolean. ctx supports three protocols — ctx.http (HTTP/undici), ctx.ftp.ls/get (FTP), and ' +
        'ctx.s3.get/head (S3-compatible object storage, SigV4-signed) — not just HTTP checks. Also ' +
        'available: ctx.assert(name, value, message?) for named assertions, ctx.warn(message) for a ' +
        'non-fatal warning status, ctx.log(message), ctx.now(), and ctx.secrets.NAME for values created ' +
        'via create_secret. timeout_ms must be at most 80% of schedule_ms. Use tags to group related ' +
        'tests — tags drive both the dashboard summary and notification-channel routing.',
      inputSchema: TestFieldsSchema.shape,
    },
    async (input) => forward('POST', '/tests', input)
  )

  server.registerTool(
    'update_test',
    {
      description: 'Update fields of a monitoring test (partial update; set enabled to pause/resume scheduling).',
      inputSchema: { id: z.string(), ...UpdateTestSchema.shape },
    },
    async ({ id, ...fields }) => forward('PATCH', `/tests/${encodeURIComponent(id)}`, fields)
  )

  server.registerTool(
    'delete_test',
    { description: 'Delete a monitoring test and its run history.', inputSchema: { id: z.string() } },
    async ({ id }) => forward('DELETE', `/tests/${encodeURIComponent(id)}`)
  )

  server.registerTool(
    'run_test_now',
    {
      description: 'Execute a test immediately and return the run result, including buffered ctx.log output.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const res = await app.inject({
        method: 'GET',
        url: `/tests/${encodeURIComponent(id)}`,
        headers: { authorization },
      })
      if (res.statusCode !== 200) return textResult(res.body, true)
      const test = JSON.parse(res.body) as Test
      if (!test.enabled) return textResult(JSON.stringify({ error: 'test is disabled' }), true)
      const logs: string[] = []
      const result = await runTest(test, { trigger: 'mcp', onLog: (m) => logs.push(m) })
      enqueue(result)
      return textResult(JSON.stringify({ ...result, logs }))
    }
  )

  server.registerTool(
    'get_test_runs',
    { description: 'Get the last 20 runs of a test, with per-run assertion results.', inputSchema: { id: z.string() } },
    async ({ id }) => forward('GET', `/tests/${encodeURIComponent(id)}/runs`)
  )

  server.registerTool(
    'get_test_incidents',
    { description: 'Get derived incidents (failure streaks crossing the threshold) for a test.', inputSchema: { id: z.string() } },
    async ({ id }) => forward('GET', `/tests/${encodeURIComponent(id)}/incidents`)
  )

  // --- overview ---

  server.registerTool(
    'get_dashboard_summary',
    {
      description: 'Get the dashboard summary for all tests (last status, 7-day pass rate, avg latency), optionally filtered by tag.',
      inputSchema: { tag: z.string().optional() },
    },
    async ({ tag }) => forward('GET', tag ? `/dashboard?tag=${encodeURIComponent(tag)}` : '/dashboard')
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
        'Create a notification channel. webhook_url is required for discord/slack/webhook types; email_to is required for email.',
      inputSchema: channelFieldsShape,
    },
    async (input) => forward('POST', '/channels', input)
  )

  server.registerTool(
    'update_channel',
    {
      description: 'Update fields of a notification channel (partial update).',
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
