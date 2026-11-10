import type { Metadata } from 'next'
import { StatusPage } from '../../_components/status-page'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const tag = decodeURIComponent((await params).slug)
  return { title: tag, description: `Live status and uptime of the checks tagged ${tag}.` }
}

export default async function TagStatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const tag = decodeURIComponent((await params).slug)
  return <StatusPage tag={tag} />
}
