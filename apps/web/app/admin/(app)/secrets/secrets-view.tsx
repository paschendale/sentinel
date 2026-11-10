'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { Secret } from '@sentinel/shared'
import { api } from '../../../../lib/auth-client'
import { longDate, plural } from '../../../../lib/format'
import { Button, ConfirmDialog, EmptyState, PageHeader, TextField, Toast } from '../../../_components/ui'

const NAME = /^[A-Z][A-Z0-9_]*$/

function AddForm({ onDone, onCancel }: { onDone: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState<{ name?: string; value?: string; submit?: string }>({})
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="sn-stack"
      style={{ padding: '12px 0 24px' }}
      onSubmit={async (e) => {
        e.preventDefault()
        if (!NAME.test(name)) return setError({ name: 'Use capitals, digits and underscores, starting with a letter: API_KEY.' })
        if (!value) return setError({ value: 'Enter the value. It is never shown again after saving.' })
        setBusy(true)
        const res = await api('/secrets', { method: 'POST', body: { name, value } })
        setBusy(false)
        if (!res.ok) return setError(res.status === 409 ? { name: `${name} already exists. Rotate it instead.` } : { submit: `Could not add the secret: ${res.error}` })
        onDone(name)
      }}
    >
      <TextField id="s-name" label="Name" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} maxLength={100} placeholder="API_KEY" error={error.name} hint="Tests read it as ctx.secrets.NAME." autoComplete="off" />
      <TextField id="s-value" label="Value" type="password" value={value} onChange={(e) => setValue(e.target.value)} error={error.value} hint="Write-only after creation." autoComplete="off" />
      {error.submit && <span className="sn-field__error">{error.submit}</span>}
      <div className="sn-row">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Add secret'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function RotateForm({ secret, onDone, onCancel }: { secret: Secret; onDone: () => void; onCancel: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="sn-row"
      style={{ alignItems: 'flex-end' }}
      onSubmit={async (e) => {
        e.preventDefault()
        if (!value) return setError('Enter the new value.')
        setBusy(true)
        const res = await api(`/secrets/${encodeURIComponent(secret.id)}/rotate`, { method: 'POST', body: { value } })
        setBusy(false)
        if (!res.ok) return setError(`Could not rotate ${secret.name}: ${res.error}`)
        onDone()
      }}
    >
      <div style={{ flex: '1 1 240px' }}>
        <TextField id={`rot-${secret.id}`} label={`New value for ${secret.name}`} type="password" value={value} onChange={(e) => setValue(e.target.value)} error={error} hint="Tests pick it up on their next run." autoComplete="off" autoFocus />
      </div>
      <Button type="submit" variant="primary" size="sm" disabled={busy}>
        {busy ? 'Saving…' : 'Rotate secret'}
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  )
}

/** Write-only secrets: name, when it was set, how many tests read it; rotate and delete. */
export function SecretsView({ secrets, usedBy, notice, failed }: { secrets: Secret[]; usedBy: Record<string, number> | null; notice: ReactNode; failed: boolean }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [rotating, setRotating] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Secret | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const done = (m: string) => {
    setToast(m)
    router.refresh()
  }
  return (
    <>
      <PageHeader
        title="Secrets"
        meta={<span>Values are write-only: nobody can read them back. Test code reads them as ctx.secrets.NAME.</span>}
        actions={
          !adding && !failed && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add secret
            </Button>
          )
        }
      />
      {notice}
      <section className="sn-narrow">
        {adding && (
          <AddForm
            onCancel={() => setAdding(false)}
            onDone={(name) => {
              setAdding(false)
              done(`${name} added. Read it in tests as ctx.secrets.${name}.`)
            }}
          />
        )}
        {secrets.length === 0 && !failed && !adding ? (
          <EmptyState title="No secrets yet" actions={<Button variant="primary" onClick={() => setAdding(true)}>Add secret</Button>}>
            A secret is a value a test needs but should not show, like an API key. Tests read it as ctx.secrets.NAME; nobody can read it back.
          </EmptyState>
        ) : secrets.length > 0 ? (
          <div className="sn-table-wrap">
            <table className="sn-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Updated</th>
                  <th className="sn-num">Used by</th>
                  <th>
                    <span className="sn-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {secrets.map((s) =>
                  rotating === s.id ? (
                    <tr key={s.id}>
                      <td colSpan={4}>
                        <RotateForm
                          secret={s}
                          onCancel={() => setRotating(null)}
                          onDone={() => {
                            setRotating(null)
                            done(`${s.name} rotated. Tests use the new value on their next run.`)
                          }}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr key={s.id}>
                      <td className="sn-fg">
                        <code>{s.name}</code>
                      </td>
                      <td>{longDate(s.updated_at as unknown as string)}</td>
                      <td className="sn-num">{usedBy ? plural(usedBy[s.name] ?? 0, 'test') : '—'}</td>
                      <td className="sn-actions">
                        <Button variant="ghost" size="sm" onClick={() => setRotating(s.id)}>
                          Rotate
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleting(s)}>
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this secret?"
        confirmLabel="Delete secret"
        busyLabel="Deleting…"
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return
          const res = await api(`/secrets/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' })
          if (!res.ok) return `Could not delete ${deleting.name}: ${res.error}`
          done(`${deleting.name} deleted.`)
        }}
      >
        {deleting && usedBy && (usedBy[deleting.name] ?? 0) > 0
          ? `${plural(usedBy[deleting.name] ?? 0, 'test')} read ${deleting.name} and will fail on their next run.`
          : 'Tests that read it will fail on their next run.'}
      </ConfirmDialog>
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  )
}
