'use client'

import { useMemo, useState } from 'react'

interface Props {
  tags: string[]
  activeTag?: string
  className?: string
}

export function TagBrowser({ tags, activeTag, className = '' }: Props) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tags
    return tags.filter(t => t.toLowerCase().includes(q))
  }, [tags, query])

  if (tags.length === 0) return null

  return (
    <div className={`flex flex-nowrap items-center gap-2 overflow-x-auto ${className}`}>
      <a
        href="/status"
        className={`shrink-0 text-xs px-3 py-1 rounded-sm transition-colors ${
          !activeTag
            ? "bg-zinc-100 text-zinc-950"
            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        }`}
      >
        all
      </a>
      {filtered.map((t) => (
        <a
          key={t}
          href={`/status/${encodeURIComponent(t)}`}
          className={`shrink-0 text-xs px-3 py-1 rounded-sm transition-colors ${
            activeTag === t
              ? "bg-emerald-900 text-emerald-300"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          }`}
        >
          {t}
        </a>
      ))}
      {filtered.length === 0 && (
        <span className="shrink-0 text-zinc-600 text-xs">
          No tags match &quot;{query}&quot;.
        </span>
      )}
    </div>
  );
}
