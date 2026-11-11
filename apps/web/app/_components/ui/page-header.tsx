import type { ReactNode } from 'react'
import { BackLink } from './back-link'

/** Back link, the page title, a meta line (status chip, since, tags) and at most one primary action. */
export function PageHeader({
  back,
  title,
  meta,
  actions,
}: {
  back?: { href: string; label: string }
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div>
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <div className="sn-pagehead">
        <div>
          <h1>{title}</h1>
          {meta && <div className="sn-pagehead__meta">{meta}</div>}
        </div>
        {actions && <div className="sn-row">{actions}</div>}
      </div>
    </div>
  )
}
