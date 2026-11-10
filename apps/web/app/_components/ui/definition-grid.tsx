import type { ReactNode } from 'react'

/** Label-and-value pairs. Values carry their unit ("5 min", "3 runs"), never a bare number. */
export function DefinitionGrid({ items }: { items: Array<{ term: string; value: ReactNode }> }) {
  return (
    <dl className="sn-defs">
      {items.map((i) => (
        <div key={i.term}>
          <dt>{i.term}</dt>
          <dd>{i.value}</dd>
        </div>
      ))}
    </dl>
  )
}
