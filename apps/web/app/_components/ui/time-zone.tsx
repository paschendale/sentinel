'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { clockTime, dateTime, type TimeZoneMode } from '../../../lib/format'

const TZ_KEY = 'sentinel-tz'

const Ctx = createContext<{ tz: TimeZoneMode; setTz: (tz: TimeZoneMode) => void }>({ tz: 'utc', setTz: () => {} })

/** Public pages: UTC by default, Local when the visitor switches (remembered per browser). */
export function TimeZoneProvider({ children }: { children: ReactNode }) {
  const [tz, setTzState] = useState<TimeZoneMode>('utc')
  useEffect(() => {
    try {
      if (localStorage.getItem(TZ_KEY) === 'local') setTzState('local')
    } catch {
      // storage unavailable: stay on UTC
    }
  }, [])
  function setTz(next: TimeZoneMode) {
    setTzState(next)
    try {
      if (next === 'local') localStorage.setItem(TZ_KEY, 'local')
      else localStorage.removeItem(TZ_KEY)
    } catch {
      // not remembered, still applied
    }
  }
  return <Ctx.Provider value={{ tz, setTz }}>{children}</Ctx.Provider>
}

export function useTimeZone() {
  return useContext(Ctx)
}

/** A timestamp in the visitor's chosen zone: clock time today, date and time otherwise. */
export function Time({ iso, clockOnly }: { iso: string; clockOnly?: boolean }) {
  const { tz } = useTimeZone()
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {clockOnly ? clockTime(iso, tz) : dateTime(iso, tz)}
    </time>
  )
}
