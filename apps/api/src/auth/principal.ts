import type { FastifyRequest } from 'fastify'
import { ADMIN_USERNAME } from '../config.js'

/**
 * Who is calling. Tokens from POST /auth/mcp-token carry `sub: 'mcp'` (and an optional
 * `label`); every other valid token, including sessions issued before this distinction
 * existed, is the signed-in person.
 */
export interface Principal {
  kind: 'person' | 'token'
  /** 'user:<name>' or 'token:<label>', as written in incident timelines. */
  author: string
}

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null
  }
}

export function principalFromClaims(claims: unknown): Principal {
  if (typeof claims === 'object' && claims !== null && (claims as { sub?: unknown }).sub === 'mcp') {
    const label = (claims as { label?: unknown }).label
    return { kind: 'token', author: `token:${typeof label === 'string' && label !== '' ? label : 'mcp'}` }
  }
  return { kind: 'person', author: `user:${ADMIN_USERNAME}` }
}

/** The caller of an authenticated route; a route behind the auth hook always has one. */
export function principalOf(req: FastifyRequest): Principal {
  return req.principal ?? principalFromClaims(null)
}
