'use client'

import { useState } from 'react'
import { fetchWithAuth } from '../../../lib/auth-client'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const EXPIRY_OPTIONS = [
  { label: '30 days', hours: 720 },
  { label: '90 days', hours: 2160 },
  { label: '1 year', hours: 8760 },
  { label: '5 years', hours: 43800 },
]

interface GeneratedToken {
  token: string
  expires_at: string
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard unavailable (e.g. non-secure context) — leave the label unchanged
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="text-zinc-500 text-xs hover:text-zinc-300 transition-colors shrink-0"
    >
      {copied ? 'copied' : 'copy'}
    </button>
  )
}

function CommandBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="block text-zinc-500 text-xs tracking-wider uppercase">{label}</span>
        <CopyButton text={text} />
      </div>
      <pre className="bg-zinc-900 border border-zinc-800 text-zinc-100 text-xs px-3 py-2 font-mono whitespace-pre-wrap break-all">{text}</pre>
    </div>
  )
}

export function TokenGenerator() {
  const [serverUrl, setServerUrl] = useState(API_URL)
  const [hours, setHours] = useState(8760)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<GeneratedToken | null>(null)

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/auth/mcp-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expires_in_hours: hours }),
      })
      if (!res.ok) {
        setError('Token generation failed.')
        return
      }
      setGenerated(await res.json() as GeneratedToken)
    } catch {
      setError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  const normalizedUrl = serverUrl.replace(/\/+$/, '')
  const addCommand = generated
    ? `claude mcp add sentinel --transport http ${normalizedUrl}/mcp --header "Authorization: Bearer ${generated.token}"`
    : ''

  return (
    <div>
      <p className="text-zinc-500 text-xs uppercase tracking-wider mb-4">MCP access</p>
      <p className="text-zinc-400 text-sm mb-6">
        Generate a long-lived token so an MCP client like Claude Code can operate this
        Sentinel instance — list and edit tests, run them, manage channels and secrets.
      </p>

      <form onSubmit={e => void handleGenerate(e)} className="flex flex-col gap-3">
        <div>
          <label className="block text-zinc-500 text-xs mb-1 tracking-wider uppercase">Server URL</label>
          <input
            type="url"
            value={serverUrl}
            onChange={e => setServerUrl(e.target.value)}
            required
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600 font-mono"
            placeholder="https://sentinel.example.com"
          />
          <p className="text-zinc-600 text-xs mt-1">
            The API URL as reachable from the machine running Claude Code — may differ from
            the internal address.
          </p>
        </div>
        <div>
          <label className="block text-zinc-500 text-xs mb-1 tracking-wider uppercase">Expires</label>
          <select
            value={hours}
            onChange={e => setHours(Number(e.target.value))}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm px-3 py-2 outline-none focus:border-zinc-600"
          >
            {EXPIRY_OPTIONS.map(o => (
              <option key={o.hours} value={o.hours}>{o.label}</option>
            ))}
          </select>
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <div>
          <button
            type="submit"
            disabled={busy}
            className="bg-zinc-100 text-zinc-950 px-4 py-2 text-sm disabled:opacity-50 hover:bg-white transition-colors"
          >
            {busy ? 'Generating…' : 'Generate token'}
          </button>
        </div>
      </form>

      {generated && (
        <div className="mt-8 pt-5 border-t border-zinc-800 flex flex-col gap-4">
          <CommandBlock label="Token" text={generated.token} />
          <CommandBlock label="Connect Claude Code" text={addCommand} />
          <p className="text-zinc-600 text-xs">
            Shown once — it is not stored and cannot be retrieved again. Expires{' '}
            {new Date(generated.expires_at).toLocaleDateString()}. There is no per-token
            revocation: rotating <code className="font-mono">JWT_SECRET</code> on the server
            invalidates all tokens and sessions.
          </p>
        </div>
      )}
    </div>
  )
}
