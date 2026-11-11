import type { FastifyInstance } from 'fastify'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { logger } from './logger.js'

/** What a fork's ctx factory gets for each run. */
export interface ForkCtxRun {
  /** Aborted when the run times out: pass it to any I/O so it stops with the run. */
  signal: AbortSignal
  /** The run's logger (carries test_id and run_id). */
  log: typeof logger
}

/**
 * The extension points a fork fills in `apps/api/src/fork/extension.ts`, so it adds behaviour
 * without editing upstream files. Every member is optional. See docs/FORKING.md.
 */
export interface ForkExtension {
  /**
   * A Fastify plugin registered after upstream's routes, at the root. Routes under `/status/`
   * are public (no token); give them the public-route treatment (cache, validate, bound).
   */
  routes?: (app: FastifyInstance) => Promise<void>
  /** Extra `ctx` members for test code, built once per run. Upstream members cannot be replaced. */
  ctx?: (run: ForkCtxRun) => Record<string, unknown>
  /** MCP tools, registered after upstream's on every MCP request. */
  mcpTools?: (server: McpServer, app: FastifyInstance, authorization: string) => void
  /** Paragraphs appended to the MCP instructions: say what the fork adds and how agents use it. */
  mcpInstructions?: readonly string[]
  /** Background work started after the API listens. Must not throw: log and carry on. */
  start?: () => void
  /** Called on shutdown, before pending results are written. */
  stop?: () => void | Promise<void>
}
