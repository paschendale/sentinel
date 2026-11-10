import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

/**
 * A labelled control with its hint or error. The label carries the unit ("Timeout (seconds)");
 * the error replaces the hint and says how to fix it.
 */
export function Field({
  label,
  hint,
  error,
  wide,
  children,
  htmlFor,
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  wide?: boolean
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className={`sn-field${wide ? ' sn-field--wide' : ''}`}>
      <label className="sn-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="sn-field__error" id={`${htmlFor}-msg`}>
          {error}
        </span>
      ) : hint ? (
        <span className="sn-field__hint" id={`${htmlFor}-msg`}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}

type Invalid = { invalid?: boolean; describedBy?: string }

export function Input({ invalid, describedBy, className, ...rest }: Invalid & InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`sn-input${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} aria-describedby={describedBy} {...rest} />
}

export function Select({ invalid, describedBy, className, ...rest }: Invalid & SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`sn-select${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} aria-describedby={describedBy} {...rest} />
}

export function Textarea({ invalid, describedBy, className, ...rest }: Invalid & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`sn-textarea${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} aria-describedby={describedBy} {...rest} />
}

/** A labelled input in one call: label above, hint or error below. */
export function TextField({
  label,
  hint,
  error,
  id,
  ...rest
}: { label: string; hint?: ReactNode; error?: string | null; id: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <Input id={id} invalid={!!error} describedBy={error || hint ? `${id}-msg` : undefined} {...rest} />
    </Field>
  )
}

/** A setting that applies on save ("Scheduled"). */
export function Switch({ label, ...rest }: { label: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <label className="sn-option">
      <input className="sn-switch" type="checkbox" role="switch" {...rest} />
      {label}
    </label>
  )
}

/** Picking rows or options in a list. */
export function Checkbox({ label, ...rest }: { label: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <label className="sn-option">
      <input className="sn-check" type="checkbox" {...rest} />
      {label}
    </label>
  )
}

