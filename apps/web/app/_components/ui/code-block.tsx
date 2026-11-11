import type { ReactNode } from 'react'

/**
 * Read-only code, error output and copyable commands. Comment lines are set in `fg-subtle`;
 * `error` sets the first line in `outage` (a run's error message).
 */
export function CodeBlock({ code, error, wrap, children }: { code?: string; error?: boolean; wrap?: boolean; children?: ReactNode }) {
  if (children !== undefined) return <pre className={`sn-code${wrap ? ' sn-code--wrap' : ''}`}>{children}</pre>
  const lines = (code ?? '').split('\n')
  return (
    <pre className={`sn-code${wrap ? ' sn-code--wrap' : ''}`}>
      {lines.map((line, i) => {
        const cls = error && i === 0 ? 'e' : /^\s*\/\//.test(line) ? 'c' : undefined
        return (
          <span key={i} className={cls}>
            {line}
            {i < lines.length - 1 ? '\n' : ''}
          </span>
        )
      })}
    </pre>
  )
}
