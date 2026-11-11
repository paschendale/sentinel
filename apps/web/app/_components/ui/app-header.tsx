'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Brand } from './logo'
import { ButtonLink } from './button'

const NAV = [
  { href: '/admin/tests', label: 'Tests' },
  { href: '/admin/incidents', label: 'Incidents' },
  { href: '/admin/notifications', label: 'Notifications' },
  { href: '/admin/secrets', label: 'Secrets' },
  { href: '/admin/tokens', label: 'API tokens' },
] as const

/**
 * The one header of every signed-in page. The current page is underlined in `accent`; the
 * Incidents count shows only while incidents are open. "Status page" leaves the admin.
 */
export function AppHeader({ openIncidents }: { openIncidents: number }) {
  const path = usePathname()
  return (
    <header className="sn-appbar">
      <Brand href="/admin/tests" />
      <nav className="sn-nav" aria-label="Main">
        {NAV.map((n) => {
          const current = path === n.href || path.startsWith(`${n.href}/`)
          return (
            <Link key={n.href} href={n.href} aria-current={current ? 'page' : undefined}>
              {n.label}
              {n.href === '/admin/incidents' && openIncidents > 0 && <span className="sn-nav__count">{openIncidents}</span>}
            </Link>
          )
        })}
        <a href="/">Status page ↗</a>
      </nav>
      <div className="sn-appbar__actions">
        <a className="sn-btn sn-btn--ghost sn-btn--sm" href="/admin/signout">
          Sign out
        </a>
        <ButtonLink variant="primary" href="/admin/tests/new">
          New test
        </ButtonLink>
      </div>
    </header>
  )
}
