import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  IncidentNoteSchema,
  IncidentReportSchema,
  LinkIncidentTestSchema,
  UpdateIncidentSchema,
} from '@sentinel/shared'
import { principalOf } from '../auth/principal.js'
import {
  addIncidentUpdate,
  getIncidentDetail,
  getIncidentRow,
  linkTestToIncident,
  listIncidents,
  publishReport,
  saveReport,
  setIncidentPublished,
  updateIncident,
  type IncidentListState,
} from '../db/queries/incidents.js'
import { sendError, sendValidationError } from './errors.js'
import { clearPublicCache } from './public-cache.js'

const LIST_STATES: readonly IncidentListState[] = ['open', 'resolved', 'all']

/** Publishing is for a person: agent (MCP) tokens get 403. */
function refuseTokens(req: FastifyRequest, reply: FastifyReply, what: string): boolean {
  if (principalOf(req).kind === 'person') return false
  void sendError(reply, 403, `only a signed-in person can ${what}; agent tokens can add internal notes and draft reports`)
  return true
}

async function exists(id: string, reply: FastifyReply): Promise<boolean> {
  if ((await getIncidentRow(id)) !== null) return true
  void sendError(reply, 404, 'not found')
  return false
}

/**
 * Stored incidents (signed in). Sentinel opens and resolves them from test states; people and
 * agents add notes, set the middle states, link tests and write the report. Only a person
 * publishes an incident, a public note or the report.
 */
export async function incidentsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { state?: string } }>('/', async (req, reply) => {
    const state = (req.query.state ?? 'all') as IncidentListState
    if (!LIST_STATES.includes(state)) return sendError(reply, 400, `state must be one of: ${LIST_STATES.join(', ')}`)
    return reply.send(await listIncidents(state))
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const detail = await getIncidentDetail(req.params.id)
    if (detail === null) return sendError(reply, 404, 'not found')
    return reply.send(detail)
  })

  app.patch<{ Params: { id: string }; Body: unknown }>('/:id', async (req, reply) => {
    const parsed = UpdateIncidentSchema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(reply, parsed.error)
    const updated = await updateIncident(req.params.id, parsed.data, principalOf(req).author)
    if (updated === null) return sendError(reply, 404, 'not found')
    if (updated.published_at !== null) clearPublicCache()
    return reply.send(updated)
  })

  app.post<{ Params: { id: string }; Body: unknown }>('/:id/tests', async (req, reply) => {
    const parsed = LinkIncidentTestSchema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(reply, parsed.error)
    if (!(await exists(req.params.id, reply))) return reply
    const outcome = await linkTestToIncident(req.params.id, parsed.data.test_id, principalOf(req).author)
    if (outcome === 'not_found') return sendError(reply, 404, 'test not found')
    if (outcome === 'already_linked') return sendError(reply, 409, 'test is already linked to this incident')
    clearPublicCache()
    return reply.status(201).send(await getIncidentDetail(req.params.id))
  })

  app.post<{ Params: { id: string }; Body: unknown }>('/:id/updates', async (req, reply) => {
    const parsed = IncidentNoteSchema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(reply, parsed.error)
    if (parsed.data.public && refuseTokens(req, reply, 'add a public note')) return reply
    if (!(await exists(req.params.id, reply))) return reply
    const update = await addIncidentUpdate({
      incident_id: req.params.id,
      body: parsed.data.body,
      author: principalOf(req).author,
      public: parsed.data.public,
    })
    if (update.public) clearPublicCache()
    return reply.status(201).send(update)
  })

  app.put<{ Params: { id: string }; Body: unknown }>('/:id/report', async (req, reply) => {
    const parsed = IncidentReportSchema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(reply, parsed.error)
    if (!(await exists(req.params.id, reply))) return reply
    const report = await saveReport(req.params.id, parsed.data)
    if (report.published_at !== null) clearPublicCache()
    return reply.send(report)
  })

  app.post<{ Params: { id: string } }>('/:id/publish', async (req, reply) => {
    if (refuseTokens(req, reply, 'publish an incident')) return reply
    const incident = await setIncidentPublished(req.params.id, true)
    if (incident === null) return sendError(reply, 404, 'not found')
    clearPublicCache()
    return reply.send(incident)
  })

  app.post<{ Params: { id: string } }>('/:id/unpublish', async (req, reply) => {
    if (refuseTokens(req, reply, 'unpublish an incident')) return reply
    const incident = await setIncidentPublished(req.params.id, false)
    if (incident === null) return sendError(reply, 404, 'not found')
    clearPublicCache()
    return reply.send(incident)
  })

  app.post<{ Params: { id: string } }>('/:id/report/publish', async (req, reply) => {
    if (refuseTokens(req, reply, 'publish a report')) return reply
    if (!(await exists(req.params.id, reply))) return reply
    const outcome = await publishReport(req.params.id)
    if (outcome === 'no_report') return sendError(reply, 404, 'this incident has no report yet')
    if (outcome === 'empty') return sendError(reply, 400, 'the report has no public text; write the public version first')
    clearPublicCache()
    return reply.send(outcome)
  })
}
