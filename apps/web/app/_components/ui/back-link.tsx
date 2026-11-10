'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { MouseEvent, ReactNode } from 'react'

/**
 * "← Tests": names where it goes. On a plain click with history to return to it goes back,
 * so filters and the period on the previous page survive; otherwise it navigates to `href`. (document.referrer is not
 * consulted: client-side navigation never updates it.)
 */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter()
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (window.history.length > 1) {
      e.preventDefault()
      router.back()
    }
  }
  return (
    <Link className="sn-back" href={href} onClick={onClick}>
      ← {children}
    </Link>
  )
}

