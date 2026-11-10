'use client'

import { useEffect, useState } from 'react'
import { THEME_KEY, type ThemeChoice } from '../../../lib/theme'
import { SegmentedControl } from './segmented-control'

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const

/** Light / Dark / System, default System. Stored per browser; applied before paint by the boot script. */
export function ThemeSwitch() {
  const [choice, setChoice] = useState<ThemeChoice>('system')
  useEffect(() => {
    try {
      const t = localStorage.getItem(THEME_KEY)
      if (t === 'light' || t === 'dark') setChoice(t)
    } catch {
      // storage unavailable
    }
  }, [])
  function apply(next: ThemeChoice) {
    setChoice(next)
    const root = document.documentElement
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, next)
    } catch {
      // not remembered, still applied
    }
    if (next === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', next)
  }
  return <SegmentedControl label="Theme" options={OPTIONS} value={choice} onChange={apply} />
}
