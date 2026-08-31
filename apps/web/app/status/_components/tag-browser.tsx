'use client'

import { useMemo, useState } from 'react'

interface Props {
  tags: string[]
  activeTag?: string
}

export function TagBrowser({ tags, activeTag }: Props) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tags
    return tags.filter(t => t.toLowerCase().includes(q))
  }, [tags, query])

  if (tags.length === 0) return null

  return (
    <div className="mb-8 space-y-3">
      <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
        <a
          href="/status"
          className={`text-xs px-3 py-1 rounded-sm transition-colors ${
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
            className={`text-xs px-3 py-1 rounded-sm transition-colors ${
              activeTag === t
                ? "bg-emerald-900 text-emerald-300"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            }`}
          >
            {t}
          </a>
        ))}
        {filtered.length === 0 && (
          <span className="text-zinc-600 text-xs">
            No tags match &quot;{query}&quot;.
          </span>
        )}
      </div>
    </div>
  );
}
