'use client'

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
    return <p className="text-sm text-neutral-500">Nothing queued yet. Paste a link above.</p>
  }

  return (
    <ul className="flex flex-col gap-1" data-testid="queue">
      {state.queue.map(track => (
        <li
          key={track.id}
          data-testid="queue-item"
          className={`flex items-center gap-3 rounded-lg p-2 ${
            track.id === state.currentTrackId ? 'bg-neutral-800' : 'hover:bg-neutral-900'
          }`}
        >
          <img src={track.thumbnail} alt="" className="h-10 w-16 rounded object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{track.title}</p>
            <p className="truncate text-xs text-neutral-500">
              {track.author} · {formatDuration(track.durationSec)} · added by {track.addedBy.name}
              {track.unplayable && ' · unavailable'}
            </p>
          </div>
          <button
            onClick={() => onRemove(track.id)}
            aria-label={`Remove ${track.title}`}
            className="px-2 text-neutral-500 hover:text-neutral-200"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}
