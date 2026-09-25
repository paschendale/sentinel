import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { registerMcpTools } from '../mcp/tools.js'

// Stateless MCP over Streamable HTTP: a fresh server + transport per request (the SDK's
// documented stateless pattern) so no session state is retained between requests.
// Auth is the global bearer-JWT onRequest hook in server.ts — /mcp is not in PUBLIC_ROUTES.
export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', async (req, reply) => {
    const server = new McpServer(
      { name: 'sentinel', version: '1.0.0' },
      {
        instructions:
          'Sentinel is a synthetic testing & uptime monitoring platform. Tests are JavaScript ' +
          'functions receiving a `ctx` object with three protocols — ctx.http (HTTP via undici), ' +
          'ctx.ftp (ctx.ftp.ls/get via basic-ftp), and ctx.s3 (ctx.s3.get/head, SigV4-signed, works ' +
          'against any S3-compatible endpoint) — plus ctx.assert, ctx.warn, ctx.log, ctx.now, and ' +
          'ctx.secrets. Tests are organized by free-form tags, which drive both the dashboard summary ' +
          '(get_dashboard_summary) and notification routing: a channel (Discord, Slack, webhook, or ' +
          'email) can be assigned to one test or to an entire tag via assign_channel, scoped to ' +
          'fail/warning/recovery event types, and only fires on state transitions past a failure ' +
          'threshold and cooldown. Secrets are write-only (never readable back) and reach test code as ' +
          'ctx.secrets.NAME. Timeouts: every ctx.http / ctx.s3 request is limited by its `timeout` option ' +
          '(ms, covering headers and the full body); a request over its limit throws code ' +
          'HTTP_TIMEOUT_ERROR / S3_TIMEOUT_ERROR. Without it, the test\'s timeout_ms bounds the request. When a ' +
          'run times out, its pending ctx calls are aborted and named in the run\'s error_message ' +
          '("in flight: GET <url> (<s>, headers received, <n> KB of body read)"). A test\'s `retries` ' +
          're-runs a failed or timed-out scheduled run up to that many times (while a full attempt still ' +
          'fits in 80% of schedule_ms) and records only the last attempt; run_test_now makes one attempt. ' +
          'Before creating a test, call list_tags to see existing tag conventions and ' +
          'list_channels to see what notification targets already exist.',
      }
    )
    registerMcpTools(server, app, req.headers['authorization'] ?? '')
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
