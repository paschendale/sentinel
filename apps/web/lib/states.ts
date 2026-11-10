import { EVENT_LABELS, RUN_RESULT_LABELS, STATE_LABELS, STATUS_SECTIONS } from '@sentinel/shared'
import type {
  IncidentSeverity,
  NotificationEventType,
  PublicStatusOutcome,
  StatusSection,
  TestStatus,
} from '@sentinel/shared'

/**
 * What a person sees for a state: one of six shapes with its word. Wire values map here and
 * nowhere else in the web app; the words come from the shared label maps.
 */
export type StateKind = 'operational' | 'degraded' | 'outage' | 'recovered' | 'unknown' | 'paused'

export const KIND_LABELS: Record<StateKind, string> = {
  operational: STATE_LABELS.up,
  degraded: STATE_LABELS.degraded,
  outage: STATE_LABELS.down,
  recovered: 'Recovered',
  unknown: STATE_LABELS.unknown,
  paused: 'Paused',
}

export const SECTION_KIND: Record<StatusSection, StateKind> = {
  critical: 'outage',
  warning: 'degraded',
  recovered: 'recovered',
  clean: 'operational',
  disabled: 'paused',
}

/** A test's state on the dashboard: its section, with No data for a test that never ran. */
export function testKind(t: { section: StatusSection; public_status?: PublicStatusOutcome; current_status?: PublicStatusOutcome }): StateKind {
  const status = t.public_status ?? t.current_status
  if (t.section === 'clean' && status === 'unknown') return 'unknown'
  return SECTION_KIND[t.section]
}

/** On public pages a recovered check reads as Operational (it is, now). */
export function publicKind(t: { section: StatusSection; current_status: PublicStatusOutcome }): StateKind {
  const k = testKind(t)
  return k === 'recovered' ? 'operational' : k
}

export function outcomeKind(o: PublicStatusOutcome): StateKind {
  return o === 'up' ? 'operational' : o === 'down' ? 'outage' : o === 'degraded' ? 'degraded' : 'unknown'
}

export function severityKind(s: IncidentSeverity): 'outage' | 'degraded' {
  return s === 'down' ? 'outage' : 'degraded'
}

/** A single run in run history: the same shapes, with the run-result words. */
export function runKind(s: TestStatus): StateKind {
  return s === 'success' ? 'operational' : s === 'warn' ? 'degraded' : 'outage'
}

export function runLabel(s: TestStatus): string {
  return RUN_RESULT_LABELS[s]
}

export const EVENT_KIND: Record<NotificationEventType, StateKind> = {
  fail: 'outage',
  warning: 'degraded',
  recovery: 'recovered',
}

export const EVENT_ORDER: readonly NotificationEventType[] = ['fail', 'warning', 'recovery']

export function eventLabel(e: NotificationEventType): string {
  return EVENT_LABELS[e]
}

/** Section headings and descriptions, top to bottom. */
export interface SectionMeta {
  title: string
  chip: string
  description: string
  /** null: hidden when empty, collapsed behind "Show all N" when not. */
  empty: string | null
}

export const SECTION_META: Record<StatusSection, SectionMeta> = {
  critical: {
    title: 'Outage',
    chip: 'Outage',
    description: 'Failing for at least the failure threshold. Newest first.',
    empty: 'Nothing is failing.',
  },
  warning: {
    title: 'Degraded',
    chip: 'Degraded',
    description: 'A warning now, or failing but under the failure threshold.',
    empty: 'Nothing is degraded.',
  },
  recovered: {
    title: 'Recovered in the last 24 hours',
    chip: 'Recovered in 24 h',
    description: 'Operational now. Most recent first.',
    empty: 'No recoveries in the last 24 hours.',
  },
  clean: {
    title: 'Operational',
    chip: 'Operational',
    description: 'Every run in the last 24 h passed.',
    empty: null,
  },
  disabled: {
    title: 'Paused',
    chip: 'Paused',
    description: 'Not scheduled.',
    empty: null,
  },
}

export { STATUS_SECTIONS }

/** Sections that are shown: Outage, Degraded and Recovered always; the others when they hold tests. */
export function visibleSections(groups: Record<StatusSection, unknown[]>, sections: readonly StatusSection[] = STATUS_SECTIONS): StatusSection[] {
  return sections.filter((s) => SECTION_META[s].empty !== null || groups[s].length > 0)
}
