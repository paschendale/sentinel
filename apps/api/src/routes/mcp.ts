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
          'functions receiving a `ctx` object with four protocols — ctx.http (HTTP via undici), ' +
          'ctx.ftp (ctx.ftp.ls/get via basic-ftp), ctx.s3 (ctx.s3.get/head, SigV4-signed, works ' +
          'against any S3-compatible endpoint), and ctx.ntrip.sourcetable(url?) (parsed STR rows of an ' +
          'NTRIP caster sourcetable, served from a shared 60-second cache) — plus ctx.assert, ctx.warn, ' +
          'ctx.log, ctx.now, and ctx.secrets. Tests are organized by free-form tags, which drive both the dashboard summary ' +
          '(get_dashboard_summary) and notification routing: a channel (Discord, Slack, webhook, or ' +
          'email) can be assigned to one test or to an entire tag via assign_channel, scoped to ' +
          'fail/warning/recovery event types, and only fires on state transitions past a failure ' +
          'threshold and cooldown. Secrets are write-only (never readable back) and reach test code as ' +
          'ctx.secrets.NAME. Before creating a test, call list_tags to see existing tag conventions and ' +
          'list_channels to see what notification targets already exist. ' +
          'THIS INSTANCE IS THE RBMC BRANCH: it monitors the real-time stations of IBGE\'s RBMC (Rede ' +
          'Brasileira de Monitoramento Contínuo dos Sistemas GNSS) by checking the RBMC-IP NTRIP caster ' +
          'sourcetable (gps-ntrip.ibge.gov.br:2101). The station list comes from the IBGE RBMCPoint ' +
          'shapefile (SG_RBMC column) — the shapefile is the source of truth and operators update it by ' +
          'replacing the file. A sync job creates exactly one test per station (tag "rbmc", name ' +
          '"RBMC - CODE - City", generated code calling ctx.ntrip.sourcetable()), adopts pre-existing ' +
          'hand-made tests, and disables tests of removed stations. Use list_rbmc_stations to see ' +
          'stations with coordinates and status, sync_rbmc_stations after replacing the shapefile, and ' +
          'never hand-create, rename, or delete station tests (the sync overwrites name/code; only ' +
          '`enabled` is yours). The public status page shows these stations on a map.',
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
