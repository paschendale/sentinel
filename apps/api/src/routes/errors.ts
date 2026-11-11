import type { FastifyError, FastifyInstance, FastifyReply, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from 'fastify'
import type { ZodError } from 'zod'
import { logger } from '../logger.js'

/** The body of every error response: a sentence people can read, plus optional structured detail. */
export interface ApiErrorBody {
  error: string
  details?: unknown
}

export function sendError(reply: FastifyReply, status: number, error: string, details?: unknown): FastifyReply {
  const body: ApiErrorBody = details === undefined ? { error } : { error, details }
  return reply.status(status).send(body)
}

/** "name: Required; timeout_ms: must be at most 80% of schedule_ms" — the first few issues. */
export function summarizeZodError(err: ZodError): string {
  const parts = err.issues.slice(0, 3).map((issue) => {
    const path = issue.path.join('.')
    return path === '' ? issue.message : `${path}: ${issue.message}`
  })
  const more = err.issues.length > 3 ? `; and ${err.issues.length - 3} more` : ''
  return parts.length === 0 ? 'invalid request' : `${parts.join('; ')}${more}`
}

/** 400 with a readable summary and the field-by-field breakdown in `details`. */
export function sendValidationError(reply: FastifyReply, err: ZodError): FastifyReply {
  return sendError(reply, 400, summarizeZodError(err), err.flatten())
}

/**
 * Makes every error leave the API as `{ error: string, details?: … }`: thrown errors, Fastify's
 * own (bad JSON, unsupported media type) and unknown routes. Unexpected errors are logged and
 * answered with a generic 500 so internals do not leak.
 */
export function registerErrorHandling(
  app: FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, typeof logger>,
): void {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500
    if (status >= 500) {
      logger.error(
        { event: 'http.inbound.exception', method: request.method, url: request.url.split('?')[0], err },
        `unhandled error on ${request.method} ${request.url.split('?')[0]}`,
      )
      return sendError(reply, 500, 'internal error')
    }
    return sendError(reply, status, err.message || 'bad request')
  })

  app.setNotFoundHandler((_request, reply) => sendError(reply, 404, 'not found'))
}
