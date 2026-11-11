'use client'

import { useState } from 'react'
import { API_URL, api } from '../../../../lib/auth-client'
import { longDate } from '../../../../lib/format'
import { Button, Callout, CodeBlock, Field, Select, TextField } from '../../../_components/ui'

const EXPIRY = [
  { label: '30 days', hours: 720 },
  { label: '90 days', hours: 2160 },
  { label: '1 year', hours: 8760 },
  { label: '5 years', hours: 43800 },
]

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 2000)
        } catch {
          // clipboard unavailable (not a secure context): the text is selectable
        }
      }}
    >
      {done ? 'Copied' : 'Copy command'}
    </Button>
  )
}

/** Issues an MCP token and shows the connect command once. */
export function TokenGenerator() {
  const [server, setServer] = useState(API_URL)
  const [label, setLabel] = useState('')
  const [hours, setHours] = useState(8760)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState<{ token: string; expires_at: string } | null>(null)

  const url = server.replace(/\/+$/, '')
  const command = token ? `claude mcp add --transport http sentinel ${url}/mcp \\\n  --header "Authorization: Bearer ${token.token}"` : ''

  return (
    <>
      <form
        className="sn-stack"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          const res = await api<{ token: string; expires_at: string }>('/auth/mcp-token', { method: 'POST', body: { expires_in_hours: hours, ...(label.trim() ? { label: label.trim() } : {}) } })
          setBusy(false)
          if (!res.ok) return setError(`Could not issue a token: ${res.error}`)
          setToken(res.data)
        }}
      >
        <TextField id="t-label" label="Name" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={50} placeholder="claude-code-laptop" hint="Optional. Shown as the author of notes this token adds to incidents. Letters, digits, spaces, dots, dashes." />
        <TextField id="t-url" label="Server URL" type="url" value={server} onChange={(e) => setServer(e.target.value)} required hint="The API as the agent’s machine reaches it; it may differ from the internal address." />
        <Field label="Expires" htmlFor="t-exp">
          <Select id="t-exp" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {EXPIRY.map((o) => (
              <option key={o.hours} value={o.hours}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {error && <span className="sn-field__error" role="alert">{error}</span>}
        <div className="sn-row">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Generating…' : 'Generate token'}
          </Button>
        </div>
      </form>
      {token && (
        <>
          <Callout tone="degraded" title="Copy this token now.">
            It is shown once and cannot be retrieved. It expires on {longDate(token.expires_at)}.
          </Callout>
          <CodeBlock wrap>{command}</CodeBlock>
          <div className="sn-row">
            <Copy text={command.replace(' \\\n  ', ' ')} />
          </div>
          <p className="sn-field__hint">
            There is no per-token revocation: rotating <code>JWT_SECRET</code> on the server signs out every token and session.
          </p>
        </>
      )}
    </>
  )
}
