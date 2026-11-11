import type { IncidentListItem } from '@sentinel/shared'
import { apiGet } from '../../../lib/api-server'
import { AppHeader } from '../../_components/ui'

/** Every signed-in page: the app header once, then the page column. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const open = await apiGet<IncidentListItem[]>('/incidents?state=open', { auth: true })
  return (
    <main className="sn-page sn">
      <AppHeader openIncidents={open.ok ? open.data.length : 0} />
      {children}
    </main>
  )
}
