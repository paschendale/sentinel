import { INCIDENT_STATES, INCIDENT_STATE_LABELS } from '@sentinel/shared'
import type { IncidentState } from '@sentinel/shared'

/**
 * Where an incident is: Investigating, Identified, Monitoring, Resolved. Earlier states are
 * filled, the current one uses `primary`, later ones are hollow. With `onSelect` each state
 * is a button that moves the incident there.
 */
export function IncidentSteps({ state, onSelect, disabled }: { state: IncidentState; onSelect?: (s: IncidentState) => void; disabled?: boolean }) {
  const cur = INCIDENT_STATES.indexOf(state)
  return (
    <ol className="sn-steps" aria-label="Incident state">
      {INCIDENT_STATES.map((s, n) => (
        <li key={s} data-done={n < cur ? '' : undefined} aria-current={n === cur ? 'step' : undefined}>
          {onSelect ? (
            <button type="button" disabled={disabled || n === cur} onClick={() => onSelect(s)}>
              {INCIDENT_STATE_LABELS[s]}
            </button>
          ) : (
            <span>{INCIDENT_STATE_LABELS[s]}</span>
          )}
        </li>
      ))}
    </ol>
  )
}

/** Who can see it: Internal (default), Published; Draft report, Report published. */
export function Visibility({ published, children }: { published: boolean; children?: string }) {
  return <span className={`sn-vis${published ? ' sn-vis--published' : ''}`}>{children ?? (published ? 'Published' : 'Internal')}</span>
}
