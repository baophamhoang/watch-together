'use client'

import {useEffect} from 'react'

export type Toast = {id: string; message: string}

export function Toasts({
  items,
  onDismiss,
}: {
  items: Toast[]
  onDismiss(id: string): void
}) {
  useEffect(() => {
    if (items.length === 0) return
    const timers = items.map(item => setTimeout(() => onDismiss(item.id), 4000))
    return () => timers.forEach(clearTimeout)
  }, [items, onDismiss])

  if (items.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed bottom-[var(--space-4)] left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-[var(--space-2)]"
      role="status"
      aria-live="polite"
    >
      {items.map(item => (
        <p
          key={item.id}
          className="rounded-[var(--radius-full)] bg-surface-raised px-[var(--space-3)] py-[var(--space-2)] text-sm text-text shadow-lg shadow-black/40"
        >
          {item.message}
        </p>
      ))}
    </div>
  )
}
