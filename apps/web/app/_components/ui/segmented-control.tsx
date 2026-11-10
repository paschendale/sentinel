import Link from 'next/link'

export interface SegmentOption<V extends string> {
  value: V
  label: string
  /** Render the option as a link (the choice lives in the URL). */
  href?: string
}

/**
 * Two to five mutually exclusive choices. The selected one uses `primary`. Give either
 * `onChange` (buttons) or an `href` per option (links, so a shared URL opens the same view).
 */
export function SegmentedControl<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly SegmentOption<V>[]
  value: V
  onChange?: (v: V) => void
}) {
  return (
    <div className="sn-seg" role="group" aria-label={label}>
      {options.map((o) =>
        o.href !== undefined ? (
          <Link key={o.value} href={o.href} scroll={false} aria-current={o.value === value ? 'true' : undefined} replace>
            {o.label}
          </Link>
        ) : (
          <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange?.(o.value)}>
            {o.label}
          </button>
        ),
      )}
    </div>
  )
}
