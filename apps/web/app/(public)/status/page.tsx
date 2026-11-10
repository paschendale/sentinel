import type { Metadata } from 'next'
import { statusTitle } from '../../../lib/site'
import { StatusPage } from '../_components/status-page'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return { title: { absolute: statusTitle() }, description: 'Live status and uptime of every check.' }
}

/** Kept for old links: the same page as `/`. */
export default function StatusIndexPage() {
  return <StatusPage />
}
