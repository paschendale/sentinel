'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface TagListProps {
  tags: string[]
  renderTag: (tag: string) => ReactNode
  size?: 'xs' | '2xs'
  className?: string
  /** Set false when tags already live inside another hover-triggered popover, to avoid stacking hover zones. */
  interactive?: boolean
}

const MORE_PILL_CLASS: Record<'xs' | '2xs', string> = {
  xs: 'text-xs px-1.5 py-0.5',
  '2xs': 'text-[10px] px-1.5 py-0.5',
}

export function TagList({ tags, renderTag, size = 'xs', className = '', interactive = true }: TagListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const moreRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(tags.length)

  useLayoutEffect(() => {
    const containerEl = containerRef.current
    if (!containerEl || tags.length === 0) return

    function recompute() {
      const containerWidth = containerEl!.clientWidth
      const gap = 4 // gap-1 = 0.25rem
      const moreWidth = moreRef.current?.offsetWidth ?? 0

      let used = 0
      let count = 0
      for (let i = 0; i < tags.length; i++) {
        const w = itemRefs.current[i]?.offsetWidth ?? 0
        const isLast = i === tags.length - 1
        const next = used + (count > 0 ? gap : 0) + w
        const reserve = isLast ? 0 : gap + moreWidth
        if (next + reserve > containerWidth) break
        used = next
        count++
      }
      setVisibleCount(count)
    }

    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(containerEl)
    return () => ro.disconnect()
  }, [tags])

  if (tags.length === 0) return null

  const hidden = tags.slice(visibleCount)

  return (
    <div ref={containerRef} className={`relative flex flex-wrap items-center gap-1 ${className}`}>
      {/* Off-flow measurement layer: natural widths of every pill + the "+N" chip */}
      <div className="absolute invisible pointer-events-none flex gap-1 whitespace-nowrap" aria-hidden>
        {tags.map((tag, i) => (
          <div key={tag} ref={el => { itemRefs.current[i] = el }}>{renderTag(tag)}</div>
        ))}
        <div ref={moreRef}>
          <span className={`${MORE_PILL_CLASS[size]} bg-zinc-800 rounded-sm`}>+99</span>
        </div>
      </div>

      {tags.slice(0, visibleCount).map(renderTag)}

      {hidden.length > 0 && (
        <MoreChip count={hidden.length} size={size} tags={interactive ? hidden : undefined} renderTag={renderTag} />
      )}
    </div>
  )
}

function MoreChip({
  count, size, tags, renderTag,
}: { count: number; size: 'xs' | '2xs'; tags?: string[]; renderTag: (tag: string) => ReactNode }) {
  return (
    <span className="relative group/more inline-block">
      <span
        tabIndex={tags ? 0 : -1}
        className={`${MORE_PILL_CLASS[size]} bg-zinc-800 text-zinc-500 rounded-sm inline-block ${tags ? 'cursor-default' : ''}`}
      >
        +{count}
      </span>
      {tags && (
        <div
          className={[
            'absolute bottom-full left-0 z-50 mb-1 w-56',
            'opacity-0 invisible pointer-events-none',
            'group-hover/more:opacity-100 group-hover/more:visible group-hover/more:pointer-events-auto',
            'group-focus-within/more:opacity-100 group-focus-within/more:visible group-focus-within/more:pointer-events-auto',
            'transition-opacity duration-150',
          ].join(' ')}
        >
          <div className="flex flex-wrap gap-1 bg-zinc-900 border border-zinc-700/80 rounded-lg p-2 shadow-xl">
            {tags.map(renderTag)}
          </div>
        </div>
      )}
    </span>
  )
}
