import { z } from 'zod'
import type { IncidentState } from './state.js'

export type IncidentSeverity = 'down' | 'degraded'

/** The report's sections, in reading order. Each has an internal and a public version. */
export const REPORT_SECTIONS = ['summary', 'impact', 'root_cause', 'resolution', 'follow_ups'] as const
export type ReportSection = (typeof REPORT_SECTIONS)[number]

export const REPORT_SECTION_LABELS: Record<ReportSection, string> = {
  summary: 'Summary',
  impact: 'Impact',
  root_cause: 'Root cause',
  resolution: 'Resolution',
  follow_ups: 'Follow-ups',
}

/** Prefix of the tag that groups tests into one incident: `incident:<group>`. */
export const INCIDENT_GROUP_TAG_PREFIX = 'incident:'

/** The group a test's incidents join, from its `incident:<group>` tag; null without one. */
export function incidentGroupOf(tags: readonly string[]): string | null {
  for (const tag of tags) {
    if (tag.startsWith(INCIDENT_GROUP_TAG_PREFIX)) {
      const group = tag.slice(INCIDENT_GROUP_TAG_PREFIX.length).trim()
      if (group !== '') return group
    }
  }
  return null
}

/** A stored incident (see migration 021). Distinct from the derived `Incident` of GET /tests/:id/incidents. */
export interface StoredIncident {
  id: string
  title: string
  severity: IncidentSeverity
  state: IncidentState
  started_at: string
  resolved_at: string | null
  /** null = internal */
  published_at: string | null
  group_key: string | null
  /** Filled when the incident resolves. */
  duration_ms: number | null
  failed_runs: number | null
  created_at: string
  updated_at: string
}

export interface IncidentTestLink {
  /** null once the test was deleted; test_name stays. */
  test_id: string | null
  test_name: string
  started_at: string
  /** When the test was Operational again; null while it is still affected. */
  ended_at: string | null
  worst_status: IncidentSeverity
}

export interface IncidentUpdate {
  id: string
  created_at: string
  kind: 'system' | 'note'
  body: string
  /** 'user:<name>', 'token:<label>' or 'system' */
  author: string
  /** Shown on the status page once the incident is published. */
  public: boolean
}

export interface IncidentReportSection {
  internal: string
  public: string
}

export interface IncidentReport {
  sections: Record<ReportSection, IncidentReportSection>
  /** null = draft */
  published_at: string | null
  updated_at: string
}

export interface IncidentListItem extends StoredIncident {
  tests: IncidentTestLink[]
  report_state: 'none' | 'draft' | 'published'
}

export interface IncidentDetail extends StoredIncident {
  tests: IncidentTestLink[]
  updates: IncidentUpdate[]
  report: IncidentReport | null
}

/** What the public status page may show of a published incident. Never carries internal text. */
export interface PublicIncident {
  id: string
  title: string
  severity: IncidentSeverity
  state: IncidentState
  started_at: string
  resolved_at: string | null
  published_at: string
  /** Names of the affected checks. */
  tests: string[]
  updates: Array<{ id: string; created_at: string; body: string }>
  /** Public versions of the report sections, when the report is published. */
  report: Record<ReportSection, string> | null
}

// --- request bodies ------------------------------------------------------------------------

export const IncidentStateSchema = z.enum(['investigating', 'identified', 'monitoring', 'resolved'])

export const UpdateIncidentShape = {
  title: z.string().trim().min(1).max(200).optional(),
  state: IncidentStateSchema.optional(),
}
export const UpdateIncidentSchema = z.object(UpdateIncidentShape).refine((d) => d.title !== undefined || d.state !== undefined, {
  message: 'set title or state',
})

export const LinkIncidentTestSchema = z.object({ test_id: z.string().min(1).max(255) })

export const IncidentNoteShape = {
  body: z.string().trim().min(1).max(5000),
  /** Show it on the status page once the incident is published. Only a signed-in person may set it. */
  public: z.boolean().default(false),
}
export const IncidentNoteSchema = z.object(IncidentNoteShape)

const sectionText = z.string().max(20_000)
const reportSectionInput = z.object({ internal: sectionText.optional(), public: sectionText.optional() })

/** Partial: only the sections and versions given are replaced. */
export const IncidentReportShape = Object.fromEntries(REPORT_SECTIONS.map((s) => [s, reportSectionInput.optional()])) as Record<
  ReportSection,
  z.ZodOptional<typeof reportSectionInput>
>
export const IncidentReportSchema = z.object(IncidentReportShape)

export type UpdateIncidentInput = z.infer<typeof UpdateIncidentSchema>
export type IncidentNoteInput = z.infer<typeof IncidentNoteSchema>
export type IncidentReportInput = z.infer<typeof IncidentReportSchema>
