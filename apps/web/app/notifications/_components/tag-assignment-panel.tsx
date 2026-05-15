'use client'

import { useRef, useEffect, useState } from 'react'
import type { NotificationChannel, NotificationChannelType } from '@sentinel/shared'
import { fetchWithAuth } from '../../../lib/auth-client'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const TYPE_BADGE_STYLES: Record<NotificationChannelType, string> = {
  discord: 'bg-indigo-950 text-indigo-400',
  slack: 'bg-emerald-950 text-emerald-400',
  webhook: 'bg-zinc-800 text-zinc-400',
  email: 'bg-amber-950 text-amber-400',
}

function ChannelTypeBadge({ type }: { type: NotificationChannelType }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-sm font-mono shrink-0 ${TYPE_BADGE_STYLES[type]}`}>
      {type}
    </span>
  )
}

interface PickerProps {
  options: NotificationChannel[]
  onSelect: (id: string) => void
  disabled?: boolean
}

function ChannelPicker({ options, onSelect, disabled }: PickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (options.length === 0) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="text-zinc-500 text-xs hover:text-zinc-300 transition-colors disabled:opacity-50 px-2 py-0.5"
      >
        + add
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-10 bg-zinc-900 border border-zinc-800 min-w-44 shadow-lg">
          {options.map(ch => (
            <button
              key={ch.id}
              type="button"
              onClick={() => { onSelect(ch.id); setOpen(false) }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <ChannelTypeBadge type={ch.type} />
              {ch.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface TagRowProps {
  tag: string
  allChannels: NotificationChannel[]
  initialAssigned: NotificationChannel[]
}

function TagRow({ tag, allChannels, initialAssigned }: TagRowProps) {
  const [assigned, setAssigned] = useState<NotificationChannel[]>(initialAssigned)
  const [busy, setBusy] = useState(false)

  async function handleAdd(channelId: string) {
    if (!channelId) return
    setBusy(true)
    try {
      const res = await fetchWithAuth(`${API_URL}/tags/${encodeURIComponent(tag)}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId }),
      })
      if (res.ok) {
        const ch = allChannels.find(c => c.id === channelId)
        if (ch) setAssigned(prev => [...prev, ch])
      }
    } catch {
      // fire-and-forget; silent failure
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(channelId: string) {
    setBusy(true)
    try {
      await fetchWithAuth(`${API_URL}/tags/${encodeURIComponent(tag)}/channels/${channelId}`, {
        method: 'DELETE',
      })
      setAssigned(prev => prev.filter(c => c.id !== channelId))
    } catch {
      // silent failure
    } finally {
      setBusy(false)
    }
  }

  const unassigned = allChannels.filter(c => !assigned.some(a => a.id === c.id))

  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-4">
        <span className="text-xs px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded-sm shrink-0 mt-0.5">{tag}</span>
        <div className="flex flex-wrap gap-1.5 flex-1 items-center">
          {assigned.map(ch => (
            <span key={ch.id} className="flex items-center gap-1.5 text-xs px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-sm">
              <ChannelTypeBadge type={ch.type} />
              {ch.name}
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRemove(ch.id)}
                className="text-zinc-600 hover:text-zinc-300 leading-none disabled:opacity-50 ml-0.5"
              >
                ×
              </button>
            </span>
          ))}
          <ChannelPicker options={unassigned} onSelect={id => void handleAdd(id)} disabled={busy} />
          {assigned.length === 0 && unassigned.length === 0 && (
            <span className="text-zinc-600 text-xs">no notifications</span>
          )}
        </div>
      </div>
    </div>
  )
}

interface Props {
  tags: string[]
  allChannels: NotificationChannel[]
  tagAssignments: Record<string, NotificationChannel[]>
}

export function TagAssignmentPanel({ tags, allChannels, tagAssignments }: Props) {
  if (tags.length === 0) return null

  return (
    <div className="mt-12">
      <p className="text-zinc-500 text-xs uppercase tracking-wider mb-4">Tag Rules</p>
      <div className="divide-y divide-zinc-800 border-t border-zinc-800">
        {tags.map(tag => (
          <TagRow
            key={tag}
            tag={tag}
            allChannels={allChannels}
            initialAssigned={tagAssignments[tag] ?? []}
          />
        ))}
      </div>
    </div>
  )
}
