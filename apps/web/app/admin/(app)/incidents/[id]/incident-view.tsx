'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { REPORT_SECTIONS, REPORT_SECTION_LABELS, sinceText } from '@sentinel/shared'
import type { IncidentDetail, IncidentState, ReportSection, TestSummary } from '@sentinel/shared'
import { api } from '../../../../../lib/auth-client'
import { dateTime } from '../../../../../lib/format'
import { severityKind, testKind } from '../../../../../lib/states'
import {
  Button,
  ButtonLink,
  Callout,
  ConfirmDialog,
  Field,
  IncidentReport,
  IncidentSteps,
  IncidentTimeline,
  Input,
  PageHeader,
  SegmentedControl,
  Select,
  StatusIndicator,
  Textarea,
  Toast,
  Visibility,
} from '../../../../_components/ui'
import { incidentDuration } from '../incident-table'

type Version = 'internal' | 'public'
type Draft = Record<ReportSection, { internal: string; public: string }>

function draftOf(i: IncidentDetail): Draft {
  return Object.fromEntries(
    REPORT_SECTIONS.map((s) => [s, { internal: i.report?.sections[s]?.internal ?? '', public: i.report?.sections[s]?.public ?? '' }]),
  ) as Draft
}

/** An incident: state, visibility, affected tests, timeline with the note composer, and the report. */
export function IncidentView({ incident: i, tests, fetchedAt }: { incident: IncidentDetail; tests: TestSummary[]; fetchedAt: string }) {
  const router = useRouter()
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<'publish' | 'report' | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(i.title)
  const [note, setNote] = useState('')
  const [notePublic, setNotePublic] = useState(false)
  const [version, setVersion] = useState<Version>('public')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => draftOf(i))
  const [link, setLink] = useState('')
  const [now, setNow] = useState(() => Date.parse(fetchedAt))
  useEffect(() => setNow(Date.now()), [])
  useEffect(() => {
    if (!editing) setDraft(draftOf(i))
  }, [i, editing])

  const published = i.published_at !== null
  const resolved = i.state === 'resolved'
  const byId = new Map(tests.map((t) => [t.id, t]))
  const linked = new Set(i.tests.map((t) => t.test_id))
  const reportState = i.report === null ? 'none' : i.report.published_at ? 'published' : 'draft'
  const shownSections = Object.fromEntries(REPORT_SECTIONS.map((s) => [s, i.report?.sections[s]?.[version] ?? ''])) as Record<ReportSection, string>
  const hasText = REPORT_SECTIONS.some((s) => shownSections[s].trim() !== '')
  const publicReport = Object.fromEntries(REPORT_SECTIONS.map((s) => [s, i.report?.sections[s]?.public ?? ''])) as Record<ReportSection, string>
  const publicNotes = i.updates.filter((u) => u.kind === 'note' && u.public).length

  async function call(path: string, init: { method?: string; body?: unknown }, done?: string): Promise<string | void> {
    setBusy(true)
    setError(null)
    const res = await api(`/incidents/${encodeURIComponent(i.id)}${path}`, { method: 'POST', ...init })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return res.error
    }
    if (done) setToast(done)
    router.refresh()
  }

  return (
    <>
      <PageHeader
        back={{ href: '/admin/incidents', label: 'Incidents' }}
        title={
          renaming ? (
            <form
              className="sn-row"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!title.trim()) return
                const err = await call('', { method: 'PATCH', body: { title: title.trim() } }, 'Title saved.')
                if (!err) setRenaming(false)
              }}
            >
              <Input aria-label="Incident title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus style={{ minWidth: 280, flex: 1 }} />
              <Button type="submit" variant="secondary" disabled={busy || !title.trim()}>
                Save title
              </Button>
              <Button variant="ghost" onClick={() => { setRenaming(false); setTitle(i.title) }}>
                Cancel
              </Button>
            </form>
          ) : (
            i.title
          )
        }
        meta={
          <>
            <StatusIndicator kind={resolved ? 'recovered' : severityKind(i.severity)} label={resolved ? 'Resolved' : undefined} chip />
            <span suppressHydrationWarning>
              {dateTime(i.started_at)} · {incidentDuration(i, now)}
            </span>
            <Visibility published={published} />
          </>
        }
        actions={
          <>
            {!renaming && (
              <Button variant="ghost" onClick={() => setRenaming(true)}>
                Rename
              </Button>
            )}
            {published ? (
              <>
                <ButtonLink variant="secondary" href={`/status/incidents/${i.id}`} external target="_blank" rel="noopener">
                  View public page ↗
                </ButtonLink>
                <Button variant="ghost" disabled={busy} onClick={() => void call('/unpublish', {}, 'Unpublished. The status page no longer shows this incident.')}>
                  Unpublish
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={() => setDialog('publish')}>
                Publish incident
              </Button>
            )}
          </>
        }
      />
      {error && (
        <Callout tone="outage" title="That did not save.">
          {error}
        </Callout>
      )}
      {!published && (
        <Callout title="Internal.">
          The status page shows the affected checks in their sections and nothing about this incident. Publishing adds the banner, the published notes and, later, the report.
        </Callout>
      )}
      <section>
        <h2 className="sn-section__title sn-h">State</h2>
        <IncidentSteps
          state={i.state}
          disabled={busy}
          onSelect={(s: IncidentState) => void call('', { method: 'PATCH', body: { state: s } }, `State set to ${s[0]!.toUpperCase()}${s.slice(1)}.`)}
        />
      </section>
      <section>
        <h2 className="sn-section__title sn-h">Affected tests</h2>
        {i.tests.map((l) => {
          const t = l.test_id ? byId.get(l.test_id) : undefined
          const since = t ? sinceText(t, new Date(now)) : null
          return (
            <div key={`${l.test_id ?? l.test_name}-${l.started_at}`} className="sn-channel">
              {l.test_id ? (
                <a className="sn-channel__name" href={`/admin/tests/${l.test_id}`}>
                  {l.test_name}
                </a>
              ) : (
                <span className="sn-channel__name">{l.test_name} (deleted)</span>
              )}
              {t && <StatusIndicator kind={testKind(t)} />}
              <span className="sn-subtle" suppressHydrationWarning>
                {l.ended_at ? `affected until ${dateTime(l.ended_at)}` : since && since.tone !== 'muted' ? since.text : 'still affected'}
              </span>
            </div>
          )
        })}
        <form
          className="sn-row"
          style={{ marginTop: 12 }}
          onSubmit={async (e) => {
            e.preventDefault()
            if (!link) return
            const err = await call('/tests', { body: { test_id: link } }, 'Test linked.')
            if (!err) setLink('')
          }}
        >
          <Select aria-label="Test to link" value={link} onChange={(e) => setLink(e.target.value)} style={{ maxWidth: 360 }}>
            <option value="">Link another test…</option>
            {tests
              .filter((t) => !linked.has(t.id))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </Select>
          <Button type="submit" variant="secondary" size="sm" disabled={busy || !link}>
            Link test
          </Button>
        </form>
      </section>
      <div className="sn-two">
        <section>
          <h2 className="sn-section__title sn-h">Timeline</h2>
          <IncidentTimeline updates={i.updates} />
          <form
            className="sn-stack sn-composer"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!note.trim()) return
              const err = await call('/updates', { body: { body: note.trim(), public: notePublic } }, notePublic && published ? 'Note added and shown on the status page.' : 'Note added.')
              if (!err) {
                setNote('')
                setNotePublic(false)
              }
            }}
          >
            <Textarea aria-label="Note" rows={3} placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
            <div className="sn-row">
              <label className="sn-option">
                <input className="sn-check" type="checkbox" checked={notePublic} onChange={(e) => setNotePublic(e.target.checked)} /> Show on status page
              </label>
              <Button type="submit" variant="secondary" style={{ marginLeft: 'auto' }} disabled={busy || !note.trim()}>
                Add note
              </Button>
            </div>
            {notePublic && !published && <span className="sn-field__hint">It appears on the status page once the incident is published.</span>}
          </form>
        </section>
        <section>
          <div className="sn-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 className="sn-section__title">Report</h2>
            <span className="sn-row" style={{ gap: 8 }}>
              {reportState !== 'none' && <Visibility published={reportState === 'published'}>{reportState === 'published' ? 'Report published' : 'Draft report'}</Visibility>}
              <SegmentedControl
                label="Version"
                options={[
                  { value: 'internal', label: 'Internal' },
                  { value: 'public', label: 'Public' },
                ]}
                value={version}
                onChange={setVersion}
              />
            </span>
          </div>
          {editing ? (
            <form
              className="sn-stack"
              onSubmit={async (e) => {
                e.preventDefault()
                const err = await call('/report', { method: 'PUT', body: draft }, reportState === 'published' ? 'Report saved. The status page shows the new public text.' : 'Report saved.')
                if (!err) setEditing(false)
              }}
            >
              <span className="sn-field__hint">
                Editing the {version} version. {version === 'public' ? 'Leave out hostnames, pod names, error messages and people’s names.' : 'For the team only; never shown on the status page.'} Markdown: paragraphs, lists, links, `code`.
              </span>
              {REPORT_SECTIONS.map((s) => (
                <Field key={`${s}-${version}`} label={REPORT_SECTION_LABELS[s]} htmlFor={`r-${s}`} wide>
                  <Textarea
                    id={`r-${s}`}
                    rows={4}
                    value={draft[s][version]}
                    onChange={(e) => setDraft((d) => ({ ...d, [s]: { ...d[s], [version]: e.target.value } }))}
                    maxLength={20000}
                  />
                </Field>
              ))}
              <div className="sn-row">
                <Button type="submit" variant="primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save report'}
                </Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <>
              {hasText ? (
                <IncidentReport sections={shownSections} />
              ) : (
                <p className="sn-emptyline">{i.report === null ? 'No report yet. Write one once the cause is known; agents can draft it through MCP.' : `The ${version} version is empty.`}</p>
              )}
              <div className="sn-row" style={{ marginTop: 16 }}>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  {i.report === null ? 'Write report' : 'Edit report'}
                </Button>
                {i.report !== null && reportState !== 'published' && (
                  <Button variant="primary" onClick={() => setDialog('report')}>
                    Publish report
                  </Button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={dialog === 'publish'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Publish this incident?"
        confirmLabel="Publish incident"
        busyLabel="Publishing…"
        onConfirm={() => call('/publish', {}, 'Published. The status page now shows this incident.')}
      >
        The status page will show a banner with the title, state, start time, {i.tests.length === 1 ? 'the affected check' : `the ${i.tests.length} affected checks`} and{' '}
        {publicNotes === 1 ? 'the 1 note' : `the ${publicNotes} notes`} marked “Show on status page”. Internal notes stay off the status page.
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'report'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Publish this report?"
        confirmLabel="Publish report"
        busyLabel="Publishing…"
        wide
        preview={REPORT_SECTIONS.some((s) => publicReport[s].trim()) ? <IncidentReport sections={publicReport} /> : <p className="sn-emptyline">The public version is empty. Write it first.</p>}
        onConfirm={() => call('/report/publish', {}, published ? 'Report published.' : 'Report published. It appears once the incident is published.')}
      >
        This public text will appear on the incident’s public page{published ? '' : ' once the incident is published'}. The internal version stays off the status page.
      </ConfirmDialog>
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  )
}
