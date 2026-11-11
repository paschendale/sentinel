'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { Tag } from './tag'

/**
 * Tags on one row; the ones that do not fit collapse into "+N", which lists them on hover
 * and focus. It fills the rest of a flex row (give the parent `display: flex`).
 */
export function TagList({ tags, hrefFor, external }: { tags: string[]; hrefFor?: (t: string) => string; external?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const measure = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(tags.length)

  useLayoutEffect(() => {
    const box = ref.current
    const m = measure.current
    if (!box || !m || tags.length === 0) return
    function recompute() {
      const width = box!.clientWidth
      const items = Array.from(m!.children) as HTMLElement[]
      const more = items[items.length - 1]?.offsetWidth ?? 24
      let used = 0
      let n = 0
      for (let i = 0; i < tags.length; i++) {
        const w = items[i]?.offsetWidth ?? 0
        const next = used + (n > 0 ? 4 : 0) + w
        const reserve = i === tags.length - 1 ? 0 : 4 + more
        if (next + reserve > width) break
        used = next
        n++
      }
      setVisible(n)
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(box)
    return () => ro.disconnect()
  }, [tags])

  if (tags.length === 0) return null
  const hidden = tags.slice(visible)
  const render = (t: string) => <Tag key={t} tag={t} href={hrefFor?.(t)} external={external} />

  return (
    <span ref={ref} className="sn-tags" style={{ position: 'relative', flexWrap: 'nowrap', flex: '1 1 0', minWidth: 0 }}>
      <span ref={measure} aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', display: 'flex', gap: 4, whiteSpace: 'nowrap' }}>
        {tags.map((t) => (
          <Tag key={t} tag={t} />
        ))}
        <span className="sn-tag">+99</span>
      </span>
      {tags.slice(0, visible).map(render)}
      {hidden.length > 0 && (
        <span className="sn-more">
          <span className="sn-tag" tabIndex={0} aria-label={`${hidden.length} more tags`}>
            +{hidden.length}
          </span>
          <span className="sn-more__list">{hidden.map(render)}</span>
        </span>
      )}
    </span>
  )
}
