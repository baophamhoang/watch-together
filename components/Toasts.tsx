'use client'

import {useEffect} from 'react'

export type Toast = {id: string; message: string}

const TOAST_MS = 4000

export function Toasts({
  items,
  onDismiss,
}: {
  items: Toast[]
  onDismiss(id: string): void
}) {
  return (
    // The container is rendered even when empty, on purpose. A live region has
    // to exist in the DOM before content is inserted into it for assistive
    // technology to reliably announce that content; a region that arrives in
    // the same commit as its first message often announces nothing at all. It
    // costs an empty, pointer-events-none div.
    <div
      className="pointer-events-none fixed bottom-[var(--space-4)] left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-[var(--space-2)]"
      role="status"
      aria-live="polite"
    >
      {items.map(item => (
        <ToastItem key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

/**
 * One timer per toast, owned by the toast. The previous version ran a single
 * effect over the whole array, so every new toast tore down and recreated every
 * timer at the full 4s — under sustained join/leave churn nothing ever expired
 * and the stack grew without bound.
 */
function ToastItem({item, onDismiss}: {item: Toast; onDismiss(id: string): void}) {
  const {id} = item

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), TOAST_MS)
    return () => clearTimeout(timer)
  }, [id, onDismiss])

  return (
    <p className="rounded-[var(--radius-full)] border border-border bg-surface-raised px-[var(--space-3)] py-[var(--space-2)] text-sm text-text">
      {item.message}
    </p>
  )
}
