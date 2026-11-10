import Link from 'next/link'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface Look {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  block?: boolean
}

function cls({ variant = 'secondary', size = 'md', block }: Look, extra?: string): string {
  return ['sn-btn', `sn-btn--${variant}`, size === 'sm' && 'sn-btn--sm', block && 'sn-btn--block', extra].filter(Boolean).join(' ')
}

/**
 * Primary completes the page (one per view), secondary for other actions, ghost for Cancel,
 * Edit and row actions, danger for Delete and Revoke (always confirmed in a Dialog).
 */
export function Button({ variant, size, block, className, type = 'button', ...rest }: Look & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cls({ variant, size, block }, className)} {...rest} />
}

/** A link styled as a button. `external` uses a plain anchor (leaves the app shell). */
export function ButtonLink({
  variant,
  size,
  block,
  className,
  href,
  external,
  children,
  ...rest
}: Look & { href: string; external?: boolean; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  if (external) {
    return (
      <a href={href} className={cls({ variant, size, block }, className)} {...rest}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={cls({ variant, size, block }, className)} {...rest}>
      {children}
    </Link>
  )
}
