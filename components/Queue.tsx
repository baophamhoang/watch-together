'use client'

import {Trash2} from 'lucide-react'
import {formatDuration} from '@/lib/format-duration'
import type {RoomState} from '@/lib/sync/types'

export function Queue({
  state,
  onRemove,
}: {
  state: RoomState
  onRemove(trackId: string): void
}) {
  if (state.queue.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing queued. Paste a YouTube link above and everyone here will see it.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-1" data-testid="queue">
      {state.queue.map(track => (
        <li
          key={track.id}
          data-testid="queue-item"
          className={`flex items-center gap-[var(--space-3)] rounded-[var(--radius-md)] p-[var(--space-2)] ${
            track.id === state.currentTrackId ? 'bg-surface-raised' : 'hover:bg-surface'
          }`}
        >
          <img src={track.thumbnail} alt="" className="h-10 w-16 shrink-0 rounded-[var(--radius-sm)] object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-text">{track.title}</p>
            <p className="truncate text-xs text-muted">
              {track.author} · {formatDuration(track.durationSec)} · added by {track.addedBy.name}
              {track.unplayable && ' · unavailable'}
            </p>
          </div>
          {track.id === state.currentTrackId && (
            <span className="shrink-0 text-xs font-medium text-live">playing</span>
          )}
          <button
            onClick={() => onRemove(track.id)}
            aria-label={`Remove ${track.title}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-raised hover:text-text cursor-pointer"
          >
            <Trash2 size={16} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}
