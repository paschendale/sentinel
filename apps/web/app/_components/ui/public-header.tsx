'use client'

import type { ReactNode } from 'react'
import { SegmentedControl } from './segmented-control'
import { ThemeSwitch } from './theme-switch'
import { useTimeZone } from './time-zone'

const TZ = [
  { value: 'utc', label: 'UTC' },
  { value: 'local', label: 'Local' },
] as const

/** UTC / Local for every time on the public pages. */
export function TimeZoneSwitch() {
  const { tz, setTz } = useTimeZone()
  return <SegmentedControl label="Times" options={TZ} value={tz} onChange={setTz} />
}

/**
 * Header of the public pages: the instance, tag, check or incident title, optional tag
 * filters under it, and the time-zone and theme switches. No sign-in link.
 */
export function PublicHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="sn-pubbar">
      <div>
        <h1 className="sn-pubbar__title">{title}</h1>
        {children && <div style={{ marginTop: 8 }}>{children}</div>}
      </div>
      <div className="sn-row">
        <TimeZoneSwitch />
        <ThemeSwitch />
      </div>
    </header>
  )
}

/** Footer of the public pages. A fork may change the right side. */
export function PublicFooter() {
  const { tz } = useTimeZone()
  return (
    <footer className="sn-pubfoot">
      <span>Times in {tz === 'utc' ? 'UTC' : 'your local time'} · refreshes every 60 s</span>
      <span>
        Powered by <a href="https://github.com/territorial-dev/sentinel">sentinel</a>, open source from territorial.dev
      </span>
    </footer>
  )
}
