import { KIND_LABELS, type StateKind } from '../../../lib/states'

/** The shape alone (disc, triangle, square, ring, grey ring, bar). Always next to a word. */
export function Mark({ kind }: { kind: StateKind }) {
  return <span className={`sn-mark sn-mark--${kind}`} aria-hidden="true" />
}

/**
 * A state as a shape and a word. Plain in tables and lists; `chip` in page headers and incident
 * rows. `label` overrides the word (run results, incident states) but never the shape.
 */
export function StatusIndicator({ kind, label, chip }: { kind: StateKind; label?: string; chip?: boolean }) {
  return (
    <span className={`sn-status sn-status--${kind}${chip ? ' sn-status--chip' : ''}`}>
      <span className="sn-mark" aria-hidden="true" />
      {label ?? KIND_LABELS[kind]}
    </span>
  )
}
