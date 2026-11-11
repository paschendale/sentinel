'use client'

import { useEffect, useRef } from 'react'

/** A short confirmation at the bottom of the viewport. Leaves after a few seconds. */
export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    if (!message) return
    const id = setTimeout(() => done.current(), 3600)
    return () => clearTimeout(id)
  }, [message])
  if (!message) return null
  return (
    <div className="sn-toast" role="status">
      {message}
    </div>
  )
}
