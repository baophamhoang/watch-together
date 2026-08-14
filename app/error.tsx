'use client'

/**
 * Last line of defence for a render-time throw. The validator in
 * `chatAction.onMessage` closes the one path a peer could reach today, but the
 * structural half of that finding was that a single throw during render
 * unmounted the entire room — player, queue and connection — to Next's default
 * error screen. This keeps the failure inside the app, in the app's own colours,
 * with a way out.
 *
 * `retry` (not `reset`) is the stable prop in Next 16.3; it re-renders the
 * boundary's children. A reload is offered alongside it because the state that
 * caused the throw survives a retry — it lives in the room hook — and a reload
 * is the only thing that clears it.
 */
export default function RoomError({retry}: {error: Error & {digest?: string}; retry: () => void}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-[var(--space-3)] px-[var(--space-4)]">
      <h1 className="text-xl font-semibold text-text">Something went wrong</h1>
      <p className="text-sm text-muted">
        The room stopped rendering. Nothing is stored, so reloading starts a
        clean session in the same room.
      </p>
      <div className="flex gap-[var(--space-2)]">
        <button
          onClick={() => retry()}
          className="min-h-11 rounded-[var(--radius-md)] border border-border px-[var(--space-3)] py-[var(--space-2)] text-sm text-text hover:border-border-strong cursor-pointer"
        >
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="min-h-11 rounded-[var(--radius-md)] bg-text px-[var(--space-3)] py-[var(--space-2)] text-sm font-medium text-bg hover:bg-text/90 cursor-pointer"
        >
          Reload
        </button>
      </div>
    </main>
  )
}
