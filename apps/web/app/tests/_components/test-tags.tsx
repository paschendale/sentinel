'use client'

import { TagList } from '../../_components/tag-list'

export function TestTags({ tags }: { tags: string[] }) {
  return (
    <TagList
      tags={tags}
      renderTag={tag => (
        <span key={tag} className="text-xs px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded-sm">{tag}</span>
      )}
    />
  )
}
