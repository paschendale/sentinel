import type { ReactNode } from 'react'
import { Mark } from './status-indicator'

/**
 * An inline message about the page's state. Degraded: something the operator should fix.
 * Outage: a failed request. Neutral: information. Not dismissible.
 */
export function Callout({ tone = 'neutral', title, children }: { tone?: 'neutral' | 'degraded' | 'outage'; title: string; children?: ReactNode }) {
  return (
    <div className={`sn-callout${tone === 'neutral' ? '' : ` sn-callout--${tone}`}`} role={tone === 'outage' ? 'alert' : undefined}>
      <Mark kind={tone === 'neutral' ? 'unknown' : tone} />
      <div>
        <b>{title}</b> {children}
      </div>
    </div>
  )
}

/** The outage callout every data-fetching page shows when its request failed. */
export function ApiErrorCallout({ what, error }: { what: string; error?: string }) {
  return (
    <Callout tone="outage" title="Could not reach the API.">
      {`The ${what} is showing nothing because the request failed, not because there is nothing to show. Retry in a moment.`}
      {error ? ` (${error})` : ''}
    </Callout>
  )
}
