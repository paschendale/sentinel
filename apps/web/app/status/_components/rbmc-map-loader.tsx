'use client'

import dynamic from 'next/dynamic'
import type { RbmcMapCollection } from '@sentinel/shared'

// MapLibre is a large client-only bundle: load it lazily, never on the server (RULES #20 spirit).
const RbmcMap = dynamic(
  () => import('./rbmc-map').then(m => ({ default: m.RbmcMap })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[72vh] min-h-[420px] w-full rounded-lg border border-zinc-800/80 bg-zinc-900/30" aria-hidden />
    ),
  }
)

interface Props {
  initial: RbmcMapCollection
  refreshUrl: string
  linkBase: '/status/tests' | '/tests'
  className?: string
}

export function RbmcMapLoader({ initial, refreshUrl, linkBase, className }: Props) {
  return <RbmcMap initial={initial} refreshUrl={refreshUrl} linkBase={linkBase} {...(className ? { className } : {})} />
}
