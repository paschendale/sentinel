import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { TEST_RESULT_CONTRACT } from '@sentinel/shared'
import { registerMcpTools } from '../mcp/tools.js'
import { USER_AGENT_URL } from '../outbound-headers.js'
import { SENTINEL_VERSION } from '../version.js'
import { fork } from '../fork/extension.js'

// What an MCP agent knows about Sentinel: it never reads docs/. This is a condensed copy of
// docs/guide/writing-tests.md, notifications.md and status-and-incidents.md; keep them in step.
export const MCP_INSTRUCTIONS = [
  'Sentinel is a synthetic testing and uptime monitor. It runs JavaScript tests on a schedule, ' +
    'alerts channels when a test changes state, keeps incidents, and publishes a public status page.',
  'Tests: code is a JavaScript function body (top-level await allowed) that receives ctx. ' + TEST_RESULT_CONTRACT +
    ' Code that does not compile is rejected with 400. ctx has ctx.http.get/post (undici), ctx.ftp.ls/get ' +
    '(basic-ftp), ctx.s3.get/head/list (SigV4-signed, any S3-compatible endpoint; list takes the bucket URL ' +
    'plus prefix/delimiter/all and returns objects with key, size and lastModified), ctx.k8s.list/read/get ' +
    '(bearer-token reads from a Kubernetes API server with an optional pinned CA, for CronJob/Job completion, ' +
    'Argo Workflows and Deployment readiness), ctx.assert(name, value, message?), ctx.warn(message), ' +
    'ctx.log(message), ctx.now() and ctx.secrets.NAME. Responses over FTP_MAX_DOWNLOAD_BYTES (default 5 MB) are aborted.',
  'Words: a test is Operational (wire value up), Degraded (degraded: it warned, or it is failing but under its ' +
    'failure_threshold), Outage (down: consecutive failures reached the threshold), No data (unknown) or Paused ' +
    '(disabled). Recovered means Operational now with a problem in the last 24 h. A run is Passed (success), ' +
    'Warned (warn), Failed (fail) or Timed out (timeout). Dashboard section keys map the same way: critical = ' +
    'Outage, warning = Degraded, recovered = Recovered, clean = Operational, disabled = Paused. Use these words ' +
    'when you report to a person; send the wire values to the tools. An instance may set a status window ' +
    '(STATUS_WINDOW_MINUTES): then Outage also needs the test to have been failing for the whole window, and ' +
    'after trouble a passing test stays Degraded until it has passed for the whole window; alerts and incidents ' +
    'follow the same states.',
  'Tags group tests and drive the dashboard summary (get_dashboard_summary), the status page and notification ' +
    'routing. Notifications: a channel (discord, slack or webhook; email through Resend; or a discord_bot or ' +
    'slack_bot) is assigned to one test or to a tag with assign_channel, for the event types fail (Outage), ' +
    'warning (Degraded) and recovery (Recovered). Alerts fire on state changes only, past the failure threshold ' +
    'and outside the cooldown. Webhook and email channels post one message per event; bot channels post one ' +
    'message per incident, keep every update in a thread under it, edit it on state change and recovery, and ' +
    'archive the thread when the test recovers. test_channel sends a one-off delivery check.',
  'Incidents are stored: one opens when a test reaches Outage (tests sharing an incident:<group> tag share one; ' +
    'a Degraded test joins an open one but never opens one), keeps a timeline and a five-section report with ' +
    'Internal and Public versions, and resolves when every linked test is Operational. Agents can read incidents, ' +
    'add internal notes, set the state (Investigating, Identified, Monitoring, Resolved), link tests and draft the ' +
    'report (list_incidents, get_incident, add_incident_note, set_incident_state, link_incident_test, ' +
    'draft_incident_report). Publishing an incident, a public note or the report is for a signed-in person only; ' +
    'no tool does it. bulk_update_tests enables, pauses, runs, deletes or re-tags many tests at once.',
  'Secrets are write-only (never readable back) and reach test code as ctx.secrets.NAME.',
  'Outbound identification: every ctx.http / ctx.s3 / ctx.k8s request and notification webhook sends ' +
    `\`User-Agent: Sentinel (+${USER_AGENT_URL})\`, with \`; instance=<name>\` and an ` +
    '`X-Sentinel-Instance: <name>` header when the deployment sets SENTINEL_INSTANCE; a User-Agent in the ' +
    "request's headers option overrides it.",
  'Timeouts: each ctx.http / ctx.s3 / ctx.k8s request is limited by its `timeout` option (ms, headers and the full ' +
    "body) and throws HTTP_TIMEOUT_ERROR / S3_TIMEOUT_ERROR / K8S_TIMEOUT_ERROR over it; without it the test's " +
    'timeout_ms bounds the request. timeout_ms must be at most 80% of schedule_ms. When a run times out, its ' +
    "pending ctx calls are aborted and named in the run's error_message (\"in flight: GET <url> (<s>, headers " +
    "received, <n> KB of body read)\"). A test's retries re-run a failed or timed-out scheduled run up to that " +
    'many times (while a full attempt still fits in 80% of schedule_ms) and record only the last attempt; ' +
    'run_test_now makes one attempt.',
  'Before creating a test, call list_tags to see the tag conventions and list_channels to see the channels that exist.',
  // A fork's paragraphs (apps/api/src/fork/extension.ts) come last.
  ...(fork.mcpInstructions ?? []),
].join('\n\n')


// Stateless MCP over Streamable HTTP: a fresh server + transport per request (the SDK's
// documented stateless pattern) so no session state is retained between requests.
// Auth is the global bearer-JWT onRequest hook in server.ts — /mcp is not in PUBLIC_ROUTES.
export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', async (req, reply) => {
    const server = new McpServer(
      { name: 'sentinel', version: SENTINEL_VERSION },
      { instructions: MCP_INSTRUCTIONS }
    )
    registerMcpTools(server, app, req.headers['authorization'] ?? '')
    fork.mcpTools?.(server, app, req.headers['authorization'] ?? '')
    // Omitting sessionIdGenerator selects the SDK's stateless mode (its docs spell this
    // as `sessionIdGenerator: undefined`, which exactOptionalPropertyTypes rejects).
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    })
    // The transport writes directly to the raw response (same escape hatch as the SSE
    // route in run.ts) — CORS headers set via reply.header are irrelevant here since
    // MCP clients are not browsers.
    reply.hijack()
    reply.raw.on('close', () => {
      void transport.close()
      void server.close()
    })
    // The SDK class's onclose getter is typed `(() => void) | undefined`, which the
    // Transport interface rejects under exactOptionalPropertyTypes — cast is safe.
    await server.connect(transport as unknown as Transport)
    await transport.handleRequest(req.raw, reply.raw, req.body)
  })

  const methodNotAllowed = async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.status(405).send({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
    })
  // Stateless mode: no SSE resumption stream to GET, no session to DELETE.
  app.get('/', methodNotAllowed)
  app.delete('/', methodNotAllowed)
}
