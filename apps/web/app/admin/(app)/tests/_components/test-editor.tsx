'use client'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { TEST_RESULT_CONTRACT, TIMEOUT_TO_SCHEDULE_MAX_RATIO } from '@sentinel/shared'
import type { AssignedChannel, NotificationChannel, NotificationEventType, Test } from '@sentinel/shared'
import { api } from '../../../../../lib/auth-client'
import { EVENT_ORDER } from '../../../../../lib/states'
import { Button, ButtonLink, ChannelRow, EventToggles, Field, PageHeader, Select, Switch, TextField } from '../../../../_components/ui'
import { defineTheme, readTheme, type MonacoTheme } from './monaco-theme'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <div className="sn-editor" aria-hidden="true" />,
})

const DEFAULT_CODE = `// Return false or throw to fail. A failed ctx.assert throws; ctx.warn marks the run as Warned.
const res = await ctx.http.get('https://example.com', { timeout: 8000 })
ctx.assert('homepage answers 200', res.status === 200)
`

interface Errors {
  name?: string
  schedule?: string
  timeout?: string
  retries?: string
  failureThreshold?: string
  cooldown?: string
  code?: string
  submit?: string
}

function sameEvents(a: NotificationEventType[], b: NotificationEventType[]) {
  return a.length === b.length && a.every((e) => b.includes(e))
}

/** New test and edit test: fields on the left, the code on the right. */
export function TestEditor({ test }: { test?: Test }) {
  const router = useRouter()
  const isNew = !test
  const [name, setName] = useState(test?.name ?? '')
  const [scheduleS, setScheduleS] = useState(String((test?.schedule_ms ?? 300_000) / 1000))
  const [timeoutS, setTimeoutS] = useState(String((test?.timeout_ms ?? 30_000) / 1000))
  const [retries, setRetries] = useState(String(test?.retries ?? 0))
  const [threshold, setThreshold] = useState(String(test?.failure_threshold ?? 3))
  const [cooldownH, setCooldownH] = useState(String((test?.cooldown_ms ?? 86_400_000) / 3_600_000))
  const [enabled, setEnabled] = useState(test?.enabled ?? true)
  const [tags, setTags] = useState((test?.tags ?? []).join(', '))
  const [code, setCode] = useState(test?.code ?? DEFAULT_CODE)
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const [channels, setChannels] = useState<NotificationChannel[]>([])
  const [assigned, setAssigned] = useState<AssignedChannel[]>([])
  const [adding, setAdding] = useState('')
  const [theme, setTheme] = useState<MonacoTheme | null>(null)

  useEffect(() => {
    void api<NotificationChannel[]>('/channels').then((r) => r.ok && setChannels(r.data))
    if (test) void api<AssignedChannel[]>(`/tests/${encodeURIComponent(test.id)}/channels`).then((r) => r.ok && setAssigned(r.data))
  }, [test])

  // Follow the page theme (and the OS, on System) in the editor.
  useEffect(() => {
    const update = () => setTheme(readTheme())
    update()
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', update)
    return () => {
      mo.disconnect()
      mq.removeEventListener('change', update)
    }
  }, [])

  function validate(): Errors {
    const e: Errors = {}
    if (!name.trim()) e.name = 'Give the test a name, for example “API · Health”.'
    const sched = Number(scheduleS)
    if (!Number.isFinite(sched) || sched < 30) e.schedule = 'The interval must be at least 30 seconds.'
    const tout = Number(timeoutS)
    const max = Math.floor(sched * TIMEOUT_TO_SCHEDULE_MAX_RATIO)
    if (!Number.isFinite(tout) || tout < 1) e.timeout = 'The timeout must be at least 1 second.'
    else if (Number.isFinite(sched) && tout > sched * TIMEOUT_TO_SCHEDULE_MAX_RATIO) e.timeout = `Timeout must leave 20% of the ${sched} s interval free. Use ${max} or less.`
    const r = Number(retries)
    if (!Number.isInteger(r) || r < 0 || r > 5) e.retries = 'Retries must be a whole number from 0 to 5.'
    const ft = Number(threshold)
    if (!Number.isInteger(ft) || ft < 1) e.failureThreshold = 'The failure threshold must be 1 or more.'
    const cd = Number(cooldownH)
    if (!Number.isFinite(cd) || cd < 0) e.cooldown = 'The cooldown must be 0 hours (off) or more.'
    if (!code.trim()) e.code = 'Write the test code first.'
    return e
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setSaving(true)
    const body = {
      name: name.trim(),
      code,
      schedule_ms: Math.round(Number(scheduleS) * 1000),
      timeout_ms: Math.round(Number(timeoutS) * 1000),
      retries: Number(retries),
      failure_threshold: Number(threshold),
      cooldown_ms: Math.round(Number(cooldownH) * 3_600_000),
      enabled,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    }
    const res = await api<Test>(isNew ? '/tests' : `/tests/${encodeURIComponent(test.id)}`, { method: isNew ? 'POST' : 'PATCH', body })
    if (!res.ok) {
      setSaving(false)
      if (res.error.startsWith('code does not compile')) setErrors({ code: `The code does not compile: ${res.error.replace(/^code does not compile:\s*/, '')}` })
      else if (/timeout_ms/.test(res.error)) setErrors({ timeout: `Timeout must leave 20% of the interval free. Use ${Math.floor(Number(scheduleS) * TIMEOUT_TO_SCHEDULE_MAX_RATIO)} or less.` })
      else setErrors({ submit: `Could not save the test: ${res.error}` })
      return
    }
    const id = res.data.id
    // Channels set on this test (tag routing lives on the Notifications page).
    const before = isNew ? [] : await api<AssignedChannel[]>(`/tests/${encodeURIComponent(id)}/channels`).then((r) => (r.ok ? r.data : []))
    const prev = new Map(before.map((c) => [c.id, c.event_types]))
    await Promise.all([
      ...assigned
        .filter((a) => !prev.has(a.id) || !sameEvents(prev.get(a.id)!, a.event_types))
        .map((a) => api(`/tests/${encodeURIComponent(id)}/channels`, { method: 'POST', body: { channel_id: a.id, event_types: a.event_types } })),
      ...before.filter((c) => !assigned.some((a) => a.id === c.id)).map((c) => api(`/tests/${encodeURIComponent(id)}/channels/${encodeURIComponent(c.id)}`, { method: 'DELETE' })),
    ])
    router.push(`/admin/tests/${id}`)
    router.refresh()
  }

  const back = test ? { href: `/admin/tests/${test.id}`, label: test.name } : { href: '/admin/tests', label: 'Tests' }
  const free = channels.filter((c) => !assigned.some((a) => a.id === c.id))

  return (
    <>
      <PageHeader back={back} title={isNew ? 'New test' : 'Edit test'} />
      <form className="sn-two sn-two--form" onSubmit={(e) => void save(e)} noValidate>
        <div className="sn-stack">
          <TextField id="f-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} error={errors.name} hint="Use “Area · What it checks”. It appears on the status page as written." />
          <div className="sn-grid3">
            <TextField id="f-interval" label="Interval (seconds)" type="number" min={30} value={scheduleS} onChange={(e) => setScheduleS(e.target.value)} error={errors.schedule} />
            <TextField id="f-timeout" label="Timeout (seconds)" type="number" min={1} value={timeoutS} onChange={(e) => setTimeoutS(e.target.value)} error={errors.timeout} />
            <TextField id="f-retries" label="Retries" type="number" min={0} max={5} value={retries} onChange={(e) => setRetries(e.target.value)} error={errors.retries} />
          </div>
          <div className="sn-grid3">
            <TextField id="f-threshold" label="Failure threshold" type="number" min={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} error={errors.failureThreshold} hint="Failed runs in a row before Outage." />
            <TextField id="f-cooldown" label="Alert cooldown (hours)" type="number" min={0} step="0.5" value={cooldownH} onChange={(e) => setCooldownH(e.target.value)} error={errors.cooldown} hint="0 turns repeats off." />
          </div>
          <TextField id="f-tags" label="Tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="layer:services, tier:core" hint="Comma separated. Tags drive status pages and alert routing; incident:<group> joins one incident." />
          <Switch label="Scheduled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <Field label="Channels on this test" htmlFor="f-channel" hint="Tag routing is set on the Notifications page; these apply to this test only.">
            <div>
              {assigned.map((ch) => (
                <ChannelRow key={ch.id} name={ch.name} type={ch.type}>
                  <EventToggles
                    value={ch.event_types}
                    onToggle={(ev) =>
                      setAssigned((list) =>
                        list.map((c) => {
                          if (c.id !== ch.id) return c
                          const next = c.event_types.includes(ev) ? c.event_types.filter((x) => x !== ev) : [...c.event_types, ev]
                          return next.length ? { ...c, event_types: EVENT_ORDER.filter((x) => next.includes(x)) } : c
                        }),
                      )
                    }
                  />
                  <Button variant="ghost" size="sm" onClick={() => setAssigned((list) => list.filter((c) => c.id !== ch.id))}>
                    Remove
                  </Button>
                </ChannelRow>
              ))}
              {free.length > 0 ? (
                <div className="sn-row" style={{ marginTop: assigned.length ? 12 : 0 }}>
                  <Select id="f-channel" value={adding} onChange={(e) => setAdding(e.target.value)} style={{ maxWidth: 280 }}>
                    <option value="">Add a channel…</option>
                    {free.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    disabled={!adding}
                    onClick={() => {
                      const ch = channels.find((c) => c.id === adding)
                      if (ch) setAssigned((list) => [...list, { ...ch, event_types: [...EVENT_ORDER] }])
                      setAdding('')
                    }}
                  >
                    Add channel
                  </Button>
                </div>
              ) : channels.length === 0 ? (
                <span className="sn-field__hint">
                  No channels yet. <a className="sn-link" href="/admin/notifications">Add one on Notifications</a>.
                </span>
              ) : null}
            </div>
          </Field>
          {errors.submit && <span className="sn-field__error" role="alert">{errors.submit}</span>}
          <div className="sn-row">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save test'}
            </Button>
            <ButtonLink variant="ghost" href={back.href}>
              Cancel
            </ButtonLink>
          </div>
        </div>
        <div className="sn-stack">
          <Field
            label="Code"
            htmlFor="f-code"
            wide
            error={errors.code}
            hint={
              <>
                The function receives <code>ctx</code>: http, s3, ftp, k8s, assert, warn, log, now, secrets. {TEST_RESULT_CONTRACT} The code is compiled when you save; a syntax error is reported here.
              </>
            }
          >
            <div className="sn-editor" id="f-code" aria-invalid={errors.code ? true : undefined}>
              {theme && (
                <MonacoEditor
                  height="100%"
                  language="javascript"
                  value={code}
                  onChange={(v) => setCode(v ?? '')}
                  theme={theme.dark ? 'sentinel-dark' : 'sentinel-light'}
                  beforeMount={(monaco) => {
                    defineTheme(monaco, theme)
                  }}
                  key={theme.dark ? 'dark' : 'light'}
                  options={{
                    fontFamily: theme.font,
                    fontSize: 13,
                    lineHeight: 20,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    padding: { top: 16, bottom: 16 },
                    renderLineHighlight: 'none',
                    tabSize: 2,
                    bracketPairColorization: { enabled: false },
                    matchBrackets: 'never',
                  }}
                />
              )}
            </div>
          </Field>
        </div>
      </form>
    </>
  )
}
