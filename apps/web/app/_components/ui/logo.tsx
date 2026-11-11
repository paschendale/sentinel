/**
 * The Beacon: a mast and signal on Territorial's tile. Outline in `fg`, signal in `accent`.
 * Below 24px the outer signal arcs are dropped.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg className={`sn-logo${className ? ` ${className}` : ''}`} viewBox="0 0 64 64" height={size} width={size} aria-hidden="true">
      <path className="ink" d="M6 46 32 34 58 46 32 58Z" />
      <path className="ink" d="M32 46V22" />
      <circle className="dot" cx="32" cy="18" r="3.2" />
      <path className="sig" d="M38.36 11.64A9 9 0 0 1 38.36 24.36M25.64 11.64A9 9 0 0 0 25.64 24.36" />
      {size >= 24 && <path className="sig2" d="M42.61 7.39A15 15 0 0 1 42.61 28.61M21.39 7.39A15 15 0 0 0 21.39 28.61" />}
    </svg>
  )
}

/** The lockup: the mark at 28px and the lowercase wordmark. */
export function Brand({ href, size = 28 }: { href?: string; size?: number }) {
  const inner = (
    <>
      <Logo size={size} />
      sentinel
    </>
  )
  return href ? (
    <a className="sn-brand" href={href}>
      {inner}
    </a>
  ) : (
    <span className="sn-brand">{inner}</span>
  )
}
