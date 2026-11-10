import { PublicFooter, TimeZoneProvider } from '../_components/ui'

/** Public pages: no signed-in nav, the time-zone choice, and the footer. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <TimeZoneProvider>
      <main className="sn-page sn-page--public sn">
        {children}
        <PublicFooter />
      </main>
    </TimeZoneProvider>
  )
}
