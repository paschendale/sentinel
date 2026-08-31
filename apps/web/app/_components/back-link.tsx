'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { MouseEvent, ReactNode } from 'react'

interface BackLinkProps {
  href: string
  children: ReactNode
  className?: string
}

/**
 * Renders a real link to `href`. On a plain left-click, if there's an actual
 * history stack to go back to, uses router.back() instead so filter/sort/
 * period state on the previous page is preserved. Falls back to plain
 * navigation to `href` for bookmarked/typed-URL visits (a fresh tab/window
 * has no history to go back to).
 *
 * Deliberately does NOT gate on document.referrer: Next.js `Link` performs
 * client-side (soft) navigation, which never touches document.referrer (only
 * a full page load does) — checking it would misfire as "no history" for
 * every soft-navigated route, e.g. the dashboard's tag-filtered test links.
 */
export function BackLink({ href, children, className }: BackLinkProps) {
  const router = useRouter()

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (window.history.length > 1) {
      e.preventDefault()
      router.back()
    }
  }

  return (
    <Link href={href} onClick={onClick} className={className}>
      {children}
    </Link>
  )
}
