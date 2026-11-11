'use client'

import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { useState, type ReactNode } from 'react'
import { Button } from './button'

/**
 * A confirmation for an action that cannot be undone or that makes something public. The title
 * is the question, the body says exactly what will happen, the confirm button repeats the verb.
 * Focus starts on Cancel and is trapped; Esc cancels. `onConfirm` returns an error message to
 * keep the dialog open with it, or nothing to close.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  preview,
  confirmLabel,
  busyLabel,
  tone = 'primary',
  onConfirm,
  wide,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  /** Exactly what will become public, shown under the body. */
  preview?: ReactNode
  confirmLabel: string
  busyLabel?: string
  tone?: 'primary' | 'danger'
  onConfirm: () => Promise<string | void> | string | void
  wide?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const err = await onConfirm()
      if (typeof err === 'string') setError(err)
      else onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!busy) {
          setError(null)
          onOpenChange(o)
        }
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="sn-scrim" />
        <AlertDialog.Content className={`sn-dialog sn${wide ? ' sn-dialog--wide' : ''}`}>
          <AlertDialog.Title asChild>
            <h2>{title}</h2>
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="sn-dialog__body">{children}</div>
          </AlertDialog.Description>
          {preview && <div className="sn-dialog__preview">{preview}</div>}
          {error && <p className="sn-dialog__error" role="alert">{error}</p>}
          <div className="sn-dialog__actions">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <Button variant={tone} disabled={busy} onClick={() => void confirm()}>
              {busy ? (busyLabel ?? `${confirmLabel}…`) : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
