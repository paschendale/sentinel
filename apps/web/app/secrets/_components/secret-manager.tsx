'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { Secret } from '@sentinel/shared'
import { fetchWithAuth } from '../../../lib/auth-client'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

function EncryptionWarningBanner() {
  return (
    <p className="text-yellow-400 text-xs bg-yellow-950/40 border border-yellow-900 px-3 py-2 mb-4">
      Secrets are stored unencrypted — set <code className="font-mono">SECRETS_ENCRYPTION_KEY</code> on
      the server to encrypt values at rest.
    </p>
  )
}

interface RotateFormProps {
  onSubmit: (value: string) => Promise<void>
  onCancel: () => void
  error: string | null
  busy: boolean
}

function RotateForm({ onSubmit, onCancel, error, busy }: RotateFormProps) {
  const [value, setValue] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await onSubmit(value)
  }

  return (
    <form onSubmit={e => void handleSubmit(e)} className="flex flex-col gap-3 mt-3">
      <div>
        <label className="block text-zinc-500 text-xs mb-1 tracking-wider uppercase">New value</label>
        <input
          type="password"
          value={value}
          onChange={e => setValue(e.target.value)}
          required
          autoComplete="off"
          className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600"
          placeholder="new secret value"
        />
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="bg-zinc-100 text-zinc-950 px-4 py-2 text-sm disabled:opacity-50 hover:bg-white transition-colors"
        >
          {busy ? 'Saving…' : 'Rotate'}
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

interface SecretRowProps {
  secret: Secret
  onUpdated: () => void
}

function SecretRow({ secret, onUpdated }: SecretRowProps) {
  const [rotating, setRotating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRotate(value: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/secrets/${secret.id}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      if (!res.ok) {
        setError('Rotate failed.')
        return
      }
      setRotating(false)
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
      const res = await fetchWithAuth(`${API_URL}/secrets/${secret.id}`, {
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
          <span className="text-zinc-100 text-sm font-mono">{secret.name}</span>
          <span className="text-zinc-600 text-xs">
            updated {new Date(secret.updated_at).toLocaleDateString()}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => { setRotating(r => !r); setConfirmDelete(false) }}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {rotating ? 'cancel' : 'rotate'}
          </button>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => { setConfirmDelete(true); setRotating(false) }}
              className="text-zinc-500 hover:text-red-400 transition-colors"
            >
              delete
            </button>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-zinc-400 text-xs">delete &ldquo;{secret.name}&rdquo;?</span>
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
      {rotating && (
        <RotateForm
          onSubmit={handleRotate}
          onCancel={() => setRotating(false)}
          error={null}
          busy={busy}
        />
      )}
    </div>
  )
}

interface CreateFormState {
  name: string
  value: string
}

interface CreateFormProps {
  onSubmit: (data: CreateFormState) => Promise<void>
  onCancel: () => void
  error: string | null
  busy: boolean
}

function CreateForm({ onSubmit, onCancel, error, busy }: CreateFormProps) {
  const [form, setForm] = useState<CreateFormState>({ name: '', value: '' })

  function set<K extends keyof CreateFormState>(k: K, v: CreateFormState[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await onSubmit(form)
  }

  return (
    <form onSubmit={e => void handleSubmit(e)} className="flex flex-col gap-3 mt-3">
      <div>
        <label className="block text-zinc-500 text-xs mb-1 tracking-wider uppercase">Name</label>
        <input
          type="text"
          value={form.name}
          onChange={e => set('name', e.target.value.toUpperCase())}
          required
          maxLength={100}
          pattern="^[A-Z][A-Z0-9_]*$"
          className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600 font-mono"
          placeholder="API_KEY"
        />
      </div>
      <div>
        <label className="block text-zinc-500 text-xs mb-1 tracking-wider uppercase">Value</label>
        <input
          type="password"
          value={form.value}
          onChange={e => set('value', e.target.value)}
          required
          autoComplete="off"
          className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600"
          placeholder="secret value"
        />
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="bg-zinc-100 text-zinc-950 px-4 py-2 text-sm disabled:opacity-50 hover:bg-white transition-colors"
        >
          {busy ? 'Saving…' : 'Create'}
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

export function SecretManager({ secrets, encryptionEnabled }: { secrets: Secret[]; encryptionEnabled: boolean }) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  function refresh() {
    router.refresh()
  }

  async function handleCreate(data: CreateFormState) {
    setCreateBusy(true)
    setCreateError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.status === 409) {
        setCreateError('A secret with this name already exists.')
        return
      }
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
      <p className="text-zinc-500 text-xs uppercase tracking-wider mb-4">Secrets</p>
      {!encryptionEnabled && <EncryptionWarningBanner />}
      <div className="divide-y divide-zinc-800 border-t border-zinc-800">
        {secrets.length === 0 && !showCreate && (
          <p className="text-zinc-500 text-sm py-8 text-center">No secrets yet.</p>
        )}
        {secrets.map(s => (
          <SecretRow key={s.id} secret={s} onUpdated={refresh} />
        ))}
      </div>

      {showCreate ? (
        <div className="pt-5 border-t border-zinc-800">
          <p className="text-zinc-400 text-sm mb-3">new secret</p>
          <CreateForm
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
          + new secret
        </button>
      )}
    </div>
  )
}
