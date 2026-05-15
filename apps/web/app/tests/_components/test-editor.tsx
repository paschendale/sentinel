'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import type { Test, NotificationChannel, NotificationChannelType } from '@sentinel/shared'
import { fetchWithAuth } from '../../../lib/auth-client'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const TYPE_BADGE_STYLES: Record<NotificationChannelType, string> = {
  discord: 'bg-indigo-950 text-indigo-400',
  slack: 'bg-emerald-950 text-emerald-400',
  webhook: 'bg-zinc-800 text-zinc-400',
  email: 'bg-amber-950 text-amber-400',
}

function NotificationTypeBadge({ type }: { type: NotificationChannelType }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-sm font-mono shrink-0 ${TYPE_BADGE_STYLES[type]}`}>
      {type}
    </span>
  )
}

interface PickerProps {
  options: NotificationChannel[]
  onSelect: (id: string) => void
  disabled?: boolean
}

function NotificationPicker({ options, onSelect, disabled }: PickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (options.length === 0) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="text-zinc-500 text-xs hover:text-zinc-300 transition-colors disabled:opacity-50"
      >
        + add
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-10 bg-zinc-900 border border-zinc-800 min-w-44 shadow-lg">
          {options.map(ch => (
            <button
              key={ch.id}
              type="button"
              onClick={() => { onSelect(ch.id); setOpen(false) }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <NotificationTypeBadge type={ch.type} />
              {ch.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const DEFAULT_CODE = `const res = await ctx.http.get('https://example.com')
ctx.assert('status ok', res.status === 200)
`

interface Props {
  test?: Test
}

interface FormErrors {
  name?: string
  schedule?: string
  timeout?: string
  retries?: string
  failureThreshold?: string
  cooldown?: string
  submit?: string
}

interface RunResult {
  status: 'success' | 'fail' | 'timeout'
  duration_ms: number
  error_message: string | null
}

export default function TestEditor({ test }: Props) {
  const router = useRouter()
  const isNew = !test

  const [name, setName] = useState(test?.name ?? '')
  const [scheduleS, setScheduleS] = useState(String((test?.schedule_ms ?? 60_000) / 1000))
  const [timeoutS, setTimeoutS] = useState(String((test?.timeout_ms ?? 5_000) / 1000))
  const [cooldownH, setCooldownH] = useState(String((test?.cooldown_ms ?? 86_400_000) / 3_600_000))
  const [retries, setRetries] = useState(String(test?.retries ?? 0))
  const [failureThreshold, setFailureThreshold] = useState(String(test?.failure_threshold ?? 3))
  const [usesBrowser, setUsesBrowser] = useState(test?.uses_browser ?? false)
  const [enabled, setEnabled] = useState(test?.enabled ?? true)
  const [tagsInput, setTagsInput] = useState((test?.tags ?? []).join(', '))
  const [code, setCode] = useState(test?.code ?? DEFAULT_CODE)
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [availableChannels, setAvailableChannels] = useState<NotificationChannel[]>([])
  const [assignedChannelIds, setAssignedChannelIds] = useState<string[]>([])

  useEffect(() => {
    fetchWithAuth(`${API_URL}/channels`)
      .then(r => r.ok ? r.json() as Promise<NotificationChannel[]> : [])
      .then(setAvailableChannels)
      .catch(() => {})
    if (test) {
      fetchWithAuth(`${API_URL}/tests/${test.id}/channels`)
        .then(r => r.ok ? r.json() as Promise<NotificationChannel[]> : [])
        .then(chs => setAssignedChannelIds(chs.map(c => c.id)))
        .catch(() => {})
    }
  }, [test?.id])

  const codeDirty = !!test && code !== test.code

  function validate(): FormErrors {
    const errs: FormErrors = {}
    if (!name.trim()) errs.name = 'Name is required.'
    const sched = Number(scheduleS)
    if (!Number.isFinite(sched) || sched < 30) errs.schedule = 'Minimum 30 seconds.'
    const tout = Number(timeoutS)
    if (!Number.isFinite(tout) || tout < 1 || tout > 10) errs.timeout = 'Must be between 1 and 10 seconds.'
    const ret = Number(retries)
    if (!Number.isFinite(ret) || ret < 0 || ret > 5) errs.retries = 'Must be between 0 and 5.'
    const ft = Number(failureThreshold)
    if (!Number.isFinite(ft) || ft < 1) errs.failureThreshold = 'Must be at least 1.'
    const cooldown = Number(cooldownH)
    if (!Number.isFinite(cooldown) || cooldown < 0) errs.cooldown = 'Must be 0 or greater.'
    return errs
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})
    setSaving(true)

    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean)

    const body = {
      name: name.trim(),
      code,
      schedule_ms: Number(scheduleS) * 1000,
      timeout_ms: Number(timeoutS) * 1000,
      retries: Number(retries),
      uses_browser: usesBrowser,
      failure_threshold: Number(failureThreshold),
      cooldown_ms: Math.round(Number(cooldownH) * 3_600_000),
      enabled,
      tags,
    }

    try {
      const url = isNew ? `${API_URL}/tests` : `${API_URL}/tests/${test.id}`
      const method = isNew ? 'POST' : 'PATCH'
      const res = await fetchWithAuth(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErrors({ submit: (data as { message?: string }).message ?? 'Save failed.' })
        return
      }
      const saved = await res.json() as Test
      const testId = saved.id

      // Sync channel assignments
      if (isNew || test) {
        const existingRes = await fetchWithAuth(`${API_URL}/tests/${testId}/channels`)
        const existing: NotificationChannel[] = existingRes.ok ? await existingRes.json() as NotificationChannel[] : []
        const existingIds = new Set(existing.map(c => c.id))
        const desiredIds = new Set(assignedChannelIds)

        await Promise.all([
          ...[...desiredIds].filter(id => !existingIds.has(id)).map(id =>
            fetchWithAuth(`${API_URL}/tests/${testId}/channels`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ channel_id: id }),
            })
          ),
          ...[...existingIds].filter(id => !desiredIds.has(id)).map(id =>
            fetchWithAuth(`${API_URL}/tests/${testId}/channels/${id}`, {
              method: 'DELETE',
            })
          ),
        ])
      }

      if (isNew) {
        router.push('/')
      } else if (test) {
        router.push(`/tests/${test.id}`)
      }
    } catch {
      setErrors({ submit: 'Network error. Is the API running?' })
    } finally {
      setSaving(false)
    }
  }

  async function handleRun() {
    if (!test) return
    setRunning(true)
    setRunResult(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/tests/${test.id}/run`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setRunResult({ status: 'fail', duration_ms: 0, error_message: (data as { error?: string }).error ?? 'Run failed.' })
        return
      }
      const result = await res.json() as RunResult
      setRunResult(result)
    } catch {
      setRunResult({ status: 'fail', duration_ms: 0, error_message: 'Network error. Is the API running?' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid h-screen bg-zinc-950" style={{ gridTemplateColumns: '300px 1fr' }}>
      {/* Left: form fields */}
      <aside className="flex flex-col gap-6 px-6 py-8 border-r border-zinc-800 overflow-y-auto">
        {isNew ? (
          <Link href="/" className="text-zinc-500 text-xs hover:text-zinc-300 transition-colors">
            ← back
          </Link>
        ) : (
          <Link href={`/tests/${test.id}`} className="text-zinc-500 text-xs hover:text-zinc-300 transition-colors">
            ← back
          </Link>
        )}

        <h1 className="text-zinc-100 text-sm">{isNew ? 'new test' : 'edit test'}</h1>

        {/* Name */}
        <div>
          <label className="block text-zinc-500 text-xs mb-1.5 tracking-wider uppercase">Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600"
            placeholder="my-api-check"
          />
          {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
        </div>

        {/* Schedule */}
        <div>
          <label className="block text-zinc-500 text-xs mb-1.5 tracking-wider uppercase">Interval (s)</label>
          <input
            type="number"
            value={scheduleS}
            onChange={e => setScheduleS(e.target.value)}
            min={30}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600"
          />
          {errors.schedule && <p className="text-red-400 text-xs mt-1">{errors.schedule}</p>}
        </div>

        {/* Timeout */}
        <div>
          <label className="block text-zinc-500 text-xs mb-1.5 tracking-wider uppercase">Timeout (s)</label>
          <input
            type="number"
            value={timeoutS}
            onChange={e => setTimeoutS(e.target.value)}
            min={1}
            max={10}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600"
          />
          {errors.timeout && <p className="text-red-400 text-xs mt-1">{errors.timeout}</p>}
        </div>

        {/* Retries */}
        <div>
          <label className="block text-zinc-500 text-xs mb-1.5 tracking-wider uppercase">Retries</label>
          <input
            type="number"
            value={retries}
            onChange={e => setRetries(e.target.value)}
            min={0}
            max={5}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600"
          />
          {errors.retries && <p className="text-red-400 text-xs mt-1">{errors.retries}</p>}
        </div>

        {/* Failure Threshold */}
        <div>
          <label className="block text-zinc-500 text-xs mb-1.5 tracking-wider uppercase">Failure Threshold</label>
          <input
            type="number"
            value={failureThreshold}
            onChange={e => setFailureThreshold(e.target.value)}
            min={1}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600"
          />
          {errors.failureThreshold && <p className="text-red-400 text-xs mt-1">{errors.failureThreshold}</p>}
        </div>

        {/* Cooldown */}
        <div>
          <label className="block text-zinc-500 text-xs mb-1.5 tracking-wider uppercase">Alert Cooldown (h)</label>
          <input
            type="number"
            value={cooldownH}
            onChange={e => setCooldownH(e.target.value)}
            min={0}
            step="0.5"
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600"
          />
          {errors.cooldown && <p className="text-red-400 text-xs mt-1">{errors.cooldown}</p>}
        </div>

        {/* Enabled */}
        <div className="flex items-center gap-3">
          <input
            id="enabled"
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="w-4 h-4 accent-zinc-100"
          />
          <label htmlFor="enabled" className="text-zinc-400 text-sm">Enabled</label>
        </div>

        {/* Uses Browser */}
        <div className="flex items-center gap-3">
          <input
            id="uses_browser"
            type="checkbox"
            checked={usesBrowser}
            onChange={e => setUsesBrowser(e.target.checked)}
            className="w-4 h-4 accent-zinc-100"
          />
          <label htmlFor="uses_browser" className="text-zinc-400 text-sm">Uses browser</label>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-zinc-500 text-xs mb-1.5 tracking-wider uppercase">Tags</label>
          <input
            type="text"
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600"
            placeholder="production, api, billing"
          />
          {tagsInput.trim() && (
            <div className="flex flex-wrap gap-1 mt-2">
              {tagsInput.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                <span key={tag} className="text-xs px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded-sm">{tag}</span>
              ))}
            </div>
          )}
        </div>

        {/* Notifications */}
        <div>
          <label className="block text-zinc-500 text-xs mb-1.5 tracking-wider uppercase">Notifications</label>
          {assignedChannelIds.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {assignedChannelIds.map(id => {
                const ch = availableChannels.find(c => c.id === id)
                return ch ? (
                  <span key={id} className="flex items-center gap-1.5 text-xs px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-sm">
                    <NotificationTypeBadge type={ch.type} />
                    {ch.name}
                    <button
                      type="button"
                      onClick={() => setAssignedChannelIds(prev => prev.filter(x => x !== id))}
                      className="text-zinc-600 hover:text-zinc-300 leading-none ml-0.5"
                    >
                      ×
                    </button>
                  </span>
                ) : null
              })}
            </div>
          )}
          <NotificationPicker
            options={availableChannels.filter(c => !assignedChannelIds.includes(c.id))}
            onSelect={id => setAssignedChannelIds(prev => [...prev, id])}
          />
          {availableChannels.length === 0 && (
            <p className="text-zinc-600 text-xs">
              No notifications set up.{' '}
              <Link href="/notifications" className="text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition-colors">
                Configure
              </Link>
            </p>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-2">
          {errors.submit && <p className="text-red-400 text-xs">{errors.submit}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-zinc-100 text-zinc-950 py-2 text-sm disabled:opacity-50 hover:bg-white transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>

          {!isNew && (
            <button
              type="button"
              onClick={handleRun}
              disabled={running || codeDirty}
              className="w-full border border-zinc-700 text-zinc-400 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:border-zinc-500 hover:text-zinc-200 transition-colors"
            >
              {running ? 'Running…' : 'Run now'}
            </button>
          )}

          {!isNew && codeDirty && (
            <p className="text-zinc-500 text-xs">
              Save before running — the server uses your last saved code.
            </p>
          )}

          {runResult && (
            <div className={`border px-3 py-2.5 text-xs flex flex-col gap-1 ${
              runResult.status === 'success'
                ? 'border-emerald-800 text-emerald-400'
                : 'border-red-900 text-red-400'
            }`}>
              <div className="flex items-center justify-between">
                <span>{runResult.status}</span>
                <span className="text-zinc-500">{runResult.duration_ms}ms</span>
              </div>
              {runResult.error_message && (
                <p className="text-zinc-400 break-words">{runResult.error_message}</p>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Right: Monaco */}
      <div className="h-full">
        <MonacoEditor
          height="100%"
          language="javascript"
          theme="vs-dark"
          value={code}
          onChange={val => setCode(val ?? '')}
          options={{
            fontFamily: 'Consolas, monospace',
            fontSize: 13,
            lineHeight: 20,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 24, bottom: 24 },
            renderLineHighlight: 'none',
          }}
        />
      </div>
    </form>
  )
}
