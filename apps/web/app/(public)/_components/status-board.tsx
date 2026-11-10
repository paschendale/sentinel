'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { compareInSection, sinceText } from '@sentinel/shared'
import type { PublicIncident, PublicStatusTest, StatusBucket, StatusPeriod, StatusSection } from '@sentinel/shared'
import { useAutoRefresh, useBuckets } from '../../../lib/use-status'
import { PERIOD_LABELS, PUBLIC_PERIODS, bucketsUptime, isPeriod } from '../../../lib/format'
import { SECTION_KIND, SECTION_META, publicKind, visibleSections } from '../../../lib/states'
import { IncidentBanner, Section, SegmentedControl, StateSectionChips, StatusBanner, StatusCard } from '../../_components/ui'

const SECTIONS: readonly StatusSection[] = ['critical', 'warning', 'recovered', 'clean']
const VIEW_KEY = 'sentinel-status-view'
type View = 'grid' | 'list'

export function StatusBoard({ tests, incidents, tag, fetchedAt }: { tests: PublicStatusTest[]; incidents: PublicIncident[]; tag?: string; fetchedAt: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const raw = params.get('period')
  // 1 h is not offered publicly; an old link with it opens the 24 h view.
  const period: StatusPeriod = isPeriod(raw) && raw !== '1h' ? raw : '24h'
  const urlView = params.get('view')
  const [view, setView] = useState<View>(urlView === 'list' ? 'list' : 'grid')
  const tick = useAutoRefresh()
  const buckets = useBuckets(period, { tag }, tick)
  const [now, setNow] = useState(() => new Date(fetchedAt))

  useEffect(() => {
    setNow(new Date())
    if (urlView === 'grid' || urlView === 'list') return
    try {
      const saved = localStorage.getItem(VIEW_KEY)
      if (saved === 'grid' || saved === 'list') {
        setView(saved)
        return
      }
    } catch {
      // storage unavailable
    }
    setView(window.innerWidth >= 768 ? 'grid' : 'list')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    next.set(key, value)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  const groups = useMemo(() => {
    const g = Object.fromEntries(SECTIONS.map((s) => [s, [] as PublicStatusTest[]])) as Record<StatusSection, PublicStatusTest[]>
    g.disabled = []
    for (const t of tests) if (t.section !== 'disabled') g[t.section].push(t)
    for (const s of SECTIONS) g[s].sort((a, b) => compareInSection(s, a, b))
    return g
  }, [tests])
  const shown = visibleSections(groups, SECTIONS)
  const counts = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])) as Record<StatusSection, number>
  const open = incidents.filter((i) => i.state !== 'resolved')
  const past = incidents.filter((i) => i.state === 'resolved')
  const nowMs = Date.parse(fetchedAt)

  return (
    <>
      <StatusBanner outage={groups.critical.length} degraded={groups.warning.length} total={tests.length} fetchedAt={fetchedAt} />
      {open.map((i) => (
        <IncidentBanner key={i.id} incident={i} now={nowMs} />
      ))}
      <div className="sn-toolbar">
        <StateSectionChips sections={shown} counts={counts} prefix="p-" />
        <span className="sn-toolbar__end">
          <SegmentedControl
            label="Period"
            options={PUBLIC_PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
            value={period}
            onChange={(p) => setParam('period', p)}
          />
          <SegmentedControl
            label="View"
            options={[
              { value: 'grid', label: 'Grid' },
              { value: 'list', label: 'List' },
            ]}
            value={view}
            onChange={(v) => {
              setView(v)
              try {
                localStorage.setItem(VIEW_KEY, v)
              } catch {
                // not remembered
              }
              setParam('view', v)
            }}
          />
        </span>
      </div>
      {tests.length === 0 ? (
        <p className="sn-emptyline">No checks are published on this page yet.</p>
      ) : (
        shown.map((s) => {
          const meta = SECTION_META[s]
          const list = groups[s]
          return (
            <Section key={s} id={`p-${s}`} kind={SECTION_KIND[s]} title={meta.title} count={list.length} description={meta.description} empty={meta.empty}>
              <div className={view === 'grid' ? 'sn-cards' : 'sn-list'}>
                {list.map((t) => {
                  const b = buckets === null ? null : (buckets.get(t.id) ?? [])
                  const since = sinceText(t, now)
                  return (
                    <StatusCard
                      key={t.id}
                      href={`/status/tests/${t.id}`}
                      name={t.name}
                      uptime={b === null ? undefined : bucketsUptime(b)}
                      period={period}
                      kind={publicKind(t)}
                      since={since.tone === 'muted' ? `no problems in ${PERIOD_LABELS[period]}` : since.text}
                      buckets={b}
                      row={view === 'list'}
                    />
                  )
                })}
              </div>
            </Section>
          )
        })
      )}
      <section>
        <h2 className="sn-section__title sn-h">Incidents in the last 30 days</h2>
        {past.length > 0 ? (
          <div className="sn-stack">
            {past.map((i) => (
              <IncidentBanner key={i.id} incident={i} now={nowMs} />
            ))}
          </div>
        ) : (
          <p className="sn-emptyline">No incidents were published in the last 30 days.</p>
        )}
      </section>
    </>
  )
}
