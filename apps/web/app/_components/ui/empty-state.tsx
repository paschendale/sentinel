import type { ReactNode } from 'react'

/** What a list shows before it has anything in it: the absence, what the thing is, the action. */
export function EmptyState({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="sn-empty">
      <h3>{title}</h3>
      <p>{children}</p>
      {actions && <div className="sn-row">{actions}</div>}
    </div>
  )
}
