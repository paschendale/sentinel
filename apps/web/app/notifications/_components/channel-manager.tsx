'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { NotificationChannel, NotificationChannelType } from '@sentinel/shared'
import { fetchWithAuth } from '../../../lib/auth-client'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const CHANNEL_TYPES: NotificationChannelType[] = ['discord', 'slack', 'webhook']

const TYPE_BADGE_STYLES: Record<NotificationChannelType, string> = {
  discord: 'bg-indigo-950 text-indigo-400',
  slack: 'bg-emerald-950 text-emerald-400',
  webhook: 'bg-zinc-800 text-zinc-400',
}

function ChannelTypeBadge({ type }: { type: NotificationChannelType }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-sm font-mono ${TYPE_BADGE_STYLES[type]}`}>
      {type}
    </span>
  )
}

interface ChannelFormState {
  name: string
  type: NotificationChannelType
  webhook_url: string
  enabled: boolean
}

function emptyForm(): ChannelFormState {
  return { name: '', type: 'discord', webhook_url: '', enabled: true }
}

function channelToForm(c: NotificationChannel): ChannelFormState {
  return { name: c.name, type: c.type, webhook_url: c.webhook_url, enabled: c.enabled }
}

interface ChannelFormProps {
  initial: ChannelFormState
  submitLabel: string
  onSubmit: (data: ChannelFormState) => Promise<void>
  onCancel: () => void
  error: string | null
  busy: boolean
}

function ChannelForm({ initial, submitLabel, onSubmit, onCancel, error, busy }: ChannelFormProps) {
  const [form, setForm] = useState<ChannelFormState>(initial)

  function set<K extends keyof ChannelFormState>(k: K, v: ChannelFormState[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await onSubmit(form)
  }

  return (
    <form onSubmit={e => void handleSubmit(e)} className="flex flex-col gap-3 mt-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-zinc-500 text-xs mb-1 tracking-wider uppercase">Name</label>
          <input
            type="text"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            required
            maxLength={100}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600"
            placeholder="my-discord"
          />
        </div>
        <div>
          <label className="block text-zinc-500 text-xs mb-1 tracking-wider uppercase">Type</label>
          <select
            value={form.type}
            onChange={e => set('type', e.target.value as NotificationChannelType)}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600"
          >
            {CHANNEL_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-zinc-500 text-xs mb-1 tracking-wider uppercase">Webhook URL</label>
        <input
          type="url"
          value={form.webhook_url}
          onChange={e => set('webhook_url', e.target.value)}
          required
          className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600"
          placeholder="https://discord.com/api/webhooks/..."
        />
      </div>
      <div className="flex items-center gap-3">
        <input
          id={`enabled-${form.name}`}
          type="checkbox"
          checked={form.enabled}
          onChange={e => set('enabled', e.target.checked)}
          className="w-4 h-4 accent-zinc-100"
        />
        <label htmlFor={`enabled-${form.name}`} className="text-zinc-400 text-sm">Enabled</label>
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="bg-zinc-100 text-zinc-950 px-4 py-2 text-sm disabled:opacity-50 hover:bg-white transition-colors"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors"
        >
          cancel
        </button>
      </div>
    </form>
  )
}

interface ChannelRowProps {
  channel: NotificationChannel
  onUpdated: () => void
}

function ChannelRow({ channel, onUpdated }: ChannelRowProps) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUpdate(data: ChannelFormState) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        setError('Save failed.')
        return
      }
      setEditing(false)
      onUpdated()
    } catch {
      setError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/channels/${channel.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        setError('Delete failed.')
        setConfirmDelete(false)
        return
      }
      onUpdated()
    } catch {
      setError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ChannelTypeBadge type={channel.type} />
          <span className="text-zinc-100 text-sm">{channel.name}</span>
          {!channel.enabled && <span className="text-zinc-600 text-xs">disabled</span>}
          <span className="text-zinc-600 text-xs font-mono truncate max-w-xs">
            {channel.webhook_url.replace(/^https?:\/\//, '').slice(0, 48)}…
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => { setEditing(e => !e); setConfirmDelete(false) }}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {editing ? 'cancel' : 'edit'}
          </button>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => { setConfirmDelete(true); setEditing(false) }}
              className="text-zinc-500 hover:text-red-400 transition-colors"
            >
              delete
            </button>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-zinc-400 text-xs">delete &ldquo;{channel.name}&rdquo;?</span>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={busy}
                className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
              >
                {busy ? 'deleting…' : 'yes'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-zinc-500 hover:text-zinc-300 text-xs"
              >
                no
              </button>
            </span>
          )}
        </div>
      </div>
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      {editing && (
        <ChannelForm
          initial={channelToForm(channel)}
          submitLabel="Save"
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
          error={null}
          busy={busy}
        />
      )}
    </div>
  )
}

export function ChannelManager({ channels }: { channels: NotificationChannel[] }) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  function refresh() {
    router.refresh()
  }

  async function handleCreate(data: ChannelFormState) {
    setCreateBusy(true)
    setCreateError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        setCreateError('Create failed.')
        return
      }
      setShowCreate(false)
      refresh()
    } catch {
      setCreateError('Network error.')
    } finally {
      setCreateBusy(false)
    }
  }

  return (
    <div>
      <p className="text-zinc-500 text-xs uppercase tracking-wider mb-4">Channels</p>
      <div className="divide-y divide-zinc-800 border-t border-zinc-800">
        {channels.length === 0 && !showCreate && (
          <p className="text-zinc-500 text-sm py-8 text-center">No notifications yet.</p>
        )}
        {channels.map(c => (
          <ChannelRow key={c.id} channel={c} onUpdated={refresh} />
        ))}
      </div>

      {showCreate ? (
        <div className="pt-5 border-t border-zinc-800">
          <p className="text-zinc-400 text-sm mb-3">new notification</p>
          <ChannelForm
            initial={emptyForm()}
            submitLabel="Create"
            onSubmit={handleCreate}
            onCancel={() => { setShowCreate(false); setCreateError(null) }}
            error={createError}
            busy={createBusy}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="mt-5 text-zinc-500 text-sm hover:text-zinc-300 transition-colors"
        >
          + new notification
        </button>
      )}
    </div>
  )
}
