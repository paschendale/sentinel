'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { STATUS_SECTIONS, compareInSection } from '@sentinel/shared'
import type { BulkTestResult, IncidentListItem, StatusSection, StatusPeriod, TestSummary } from '@sentinel/shared'
import { api } from '../../../../lib/auth-client'
import { PERIODS, PERIOD_LABELS, isPeriod, plural } from '../../../../lib/format'
import { SECTION_KIND, SECTION_META, visibleSections } from '../../../../lib/states'
import {
  BulkBar,
  ButtonLink,
  ConfirmDialog,
  EmptyState,
  SearchBox,
  Section,
  SegmentedControl,
  StateSectionChips,
  TagFilters,
  TestTable,
  type BulkAction,
} from '../../../_components/ui'
import { useBuckets } from '../../../../lib/use-status'

const ACTIONS: BulkAction[] = [
  { id: 'run', label: 'Run now' },
  { id: 'disable', label: 'Pause' },
  { id: 'enable', label: 'Resume' },
  { id: 'add_tag', label: 'Add tag…', needsTag: true },
  { id: 'delete', label: 'Delete…', variant: 'danger' },
]

const DONE: Record<string, string> = { run: 'Started', disable: 'Paused', enable: 'Resumed', add_tag: 'Tagged', remove_tag: 'Untagged', delete: 'Deleted' }

/** More than this many tests in one action is confirmed in a Dialog. */
const CONFIRM_OVER = 20

function matches(t: TestSummary, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return t.name.toLowerCase().includes(needle) || t.tags.some((x) => x.toLowerCase().includes(needle))
}

export function Dashboard({ tests, openIncidents, fetchedAt }: { tests: TestSummary[]; openIncidents: IncidentListItem[]; fetchedAt: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const tag = params.get('tag')
  const rawPeriod = params.get('period')
  const period: StatusPeriod = isPeriod(rawPeriod) ? rawPeriod : '24h'
  const [q, setQ] = useState(params.get('q') ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ action: string; tag?: string; count: number } | null>(null)
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(() => new Date(fetchedAt))
  const buckets = useBuckets(period, {}, tick)

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const href = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') next.delete(k)
        else next.set(k, v)
      }
      const s = next.toString()
      return s ? `${pathname}?${s}` : pathname
    },
    [params, pathname],
  )

  // The query lives in the URL next to ?tag=, written as you type.
  useEffect(() => {
    const current = params.get('q') ?? ''
    if (current === q) return
    const id = setTimeout(() => router.replace(href({ q }), { scroll: false }), 200)
    return () => clearTimeout(id)
  }, [q, params, router, href])

  const incidentOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of openIncidents) for (const l of i.tests) if (l.test_id && l.ended_at === null) m.set(l.test_id, i.id)
    for (const i of openIncidents) for (const l of i.tests) if (l.test_id && !m.has(l.test_id)) m.set(l.test_id, i.id)
    return (id: string) => m.get(id)
  }, [openIncidents])

  const allTags = useMemo(() => [...new Set(tests.flatMap((t) => t.tags))].sort(), [tests])
  const list = useMemo(() => tests.filter((t) => (!tag || t.tags.includes(tag)) && matches(t, q.trim())), [tests, tag, q])
  const groups = useMemo(() => {
    const g = Object.fromEntries(STATUS_SECTIONS.map((s) => [s, [] as TestSummary[]])) as Record<StatusSection, TestSummary[]>
    for (const t of list) g[t.section].push(t)
    for (const s of STATUS_SECTIONS) g[s].sort((a, b) => compareInSection(s, a, b))
    return g
  }, [list])
  const searching = q.trim() !== ''
  const shown = searching ? STATUS_SECTIONS.filter((s) => groups[s].length > 0) : visibleSections(groups)
  const counts = Object.fromEntries(STATUS_SECTIONS.map((s) => [s, groups[s].length])) as Record<StatusSection, number>

  // Selection only keeps tests that are still listed.
  useEffect(() => {
    setSelected((sel) => {
      const ids = new Set(tests.map((t) => t.id))
      const next = new Set([...sel].filter((id) => ids.has(id)))
      return next.size === sel.size ? sel : next
    })
  }, [tests])

  async function run(action: string, bulkTag?: string) {
    const ids = [...selected]
    setBusy(true)
    setMessage(null)
    const res = await api<{ results: BulkTestResult[] }>('/tests/bulk', { method: 'POST', body: { ids, action, ...(bulkTag ? { tag: bulkTag } : {}) } })
    setBusy(false)
    if (!res.ok) return res.error
    const failed = res.data.results.filter((r) => !r.ok)
    const done = ids.length - failed.length
    const verb = DONE[action] ?? 'Updated'
    setMessage(
      `${verb} ${plural(done, 'test')}${action === 'run' ? '; results appear in each test’s runs' : ''}.` +
        (failed.length ? ` ${plural(failed.length, 'test')} not changed: ${[...new Set(failed.map((f) => f.error ?? 'refused'))].join(', ')}.` : ''),
    )
    setSelected(new Set())
    setTick((t) => t + 1)
    router.refresh()
  }

  function onAction(action: string, bulkTag?: string) {
    if (action === 'delete' || selected.size > CONFIRM_OVER) setConfirm({ action, tag: bulkTag, count: selected.size })
    else void run(action, bulkTag)
  }

  const confirmCopy = (() => {
    if (!confirm) return null
    const n = plural(confirm.count, 'test')
    if (confirm.action === 'delete') return { title: 'Delete the selected tests?', body: `${n} and their run history and uptime figures are deleted. Incidents they were part of are kept. This cannot be undone.`, label: 'Delete tests', tone: 'danger' as const }
    const verb = ACTIONS.find((a) => a.id === confirm.action)?.label.replace('…', '') ?? 'Apply'
    return { title: `${verb} ${n}?`, body: `This applies to all ${n} selected, across every section.${confirm.tag ? ` Tag: ${confirm.tag}.` : ''}`, label: `${verb} ${n}`, tone: 'primary' as const }
  })()

  if (tests.length === 0) {
    return (
      <EmptyState
        title="No tests yet"
        actions={
          <>
            <ButtonLink variant="primary" href="/admin/tests/new">
              New test
            </ButtonLink>
            <ButtonLink variant="ghost" href="/admin/tokens">
              Connect an agent
            </ButtonLink>
          </>
        }
      >
        A test is a JavaScript function that runs on a schedule. Write one here, or ask an agent to create it through the MCP server.
      </EmptyState>
    )
  }

  const filterLabel = [q.trim() && `“${q.trim()}”`, tag && `tagged ${tag}`].filter(Boolean).join(' ')

  return (
    <>
      <div className="sn-toolbar">
        <SearchBox value={q} onChange={setQ} />
        <span className="sn-muted sn-num">{list.length === tests.length ? plural(tests.length, 'test') : `${list.length} of ${plural(tests.length, 'test')}`}</span>
        <span className="sn-toolbar__end">
          <SegmentedControl label="Period" options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p], href: href({ period: p === '24h' ? null : p }) }))} value={period} />
        </span>
      </div>
      <TagFilters tags={allTags} current={tag} allHref={href({ tag: null })} hrefFor={(t) => href({ tag: t })} />
      {list.length === 0 ? (
        <p className="sn-emptyline">
          No tests match {filterLabel}.{' '}
          <a
            className="sn-link"
            href={href({ q: null, tag: null })}
            onClick={(e) => {
              e.preventDefault()
              setQ('')
              router.replace(href({ q: null, tag: null }), { scroll: false })
            }}
          >
            Clear
          </a>
        </p>
      ) : (
        <>
          <StateSectionChips sections={shown} counts={counts} prefix="a-" />
          {shown.map((s) => {
            const meta = SECTION_META[s]
            return (
              <Section
                key={s}
                id={`a-${s}`}
                kind={SECTION_KIND[s]}
                title={meta.title}
                count={groups[s].length}
                description={meta.description}
                empty={meta.empty}
                collapsible={meta.empty === null}
                forceOpen={searching}
              >
                <TestTable
                  rows={groups[s]}
                  buckets={buckets}
                  period={period}
                  selected={selected}
                  onToggle={(id, on) =>
                    setSelected((sel) => {
                      const next = new Set(sel)
                      if (on) next.add(id)
                      else next.delete(id)
                      return next
                    })
                  }
                  incidentOf={incidentOf}
                  tagHref={(t) => href({ tag: t })}
                  now={now}
                />
              </Section>
            )
          })}
        </>
      )}
      <BulkBar
        count={selected.size}
        actions={ACTIONS}
        busy={busy}
        message={message}
        onAction={onAction}
        onClear={() => {
          setSelected(new Set())
          setMessage(null)
        }}
      />
      {confirmCopy && (
        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirmCopy.title}
          confirmLabel={confirmCopy.label}
          tone={confirmCopy.tone}
          onConfirm={() => run(confirm!.action, confirm!.tag)}
        >
          {confirmCopy.body}
        </ConfirmDialog>
      )}
    </>
  )
}
