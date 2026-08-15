'use client'

import {DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors} from '@dnd-kit/core'
import type {DragEndEvent} from '@dnd-kit/core'
import {restrictToParentElement, restrictToVerticalAxis} from '@dnd-kit/modifiers'
import {SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy} from '@dnd-kit/sortable'
import {CSS} from '@dnd-kit/utilities'
import {GripVertical, Trash2} from 'lucide-react'
import {formatDuration} from '@/lib/format-duration'
import type {RoomState, Track} from '@/lib/sync/types'

export function Queue({
  state,
  onRemove,
  onReorder,
}: {
  state: RoomState
  onRemove(trackId: string): void
  onReorder(trackId: string, toIndex: number): void
}) {
  const sensors = useSensors(
    // A drag must travel 6px before it starts. Without this the handle
    // swallows taps, and on touch a stationary press would begin a drag
    // instead of letting the panel scroll.
    useSensor(PointerSensor, {activationConstraint: {distance: 6}}),
    useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates}),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const {active, over} = event
    // `over` is null when a drag is released outside the list.
    if (!over || active.id === over.id) return
    const toIndex = state.queue.findIndex(t => t.id === over.id)
    if (toIndex === -1) return
    onReorder(String(active.id), toIndex)
  }

  if (state.queue.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing queued. Paste a YouTube link above and everyone here will see it.
      </p>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={state.queue.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-[var(--space-1)]" data-testid="queue">
          {state.queue.map(track => (
            <QueueRow
              key={track.id}
              track={track}
              isCurrent={track.id === state.currentTrackId}
              onRemove={onRemove}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function QueueRow({
  track,
  isCurrent,
  onRemove,
}: {
  track: Track
  isCurrent: boolean
  onRemove(trackId: string): void
}) {
  // `setNodeRef` goes on the <li> — the thing that moves. `setActivatorNodeRef`
  // goes on the handle — the thing you grab. Putting the node ref on the button
  // is the usual mistake and makes dnd-kit measure the handle instead of the
  // row, so the drag preview is a 24px sliver and the drop targets are wrong.
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({id: track.id})

  return (
    <li
      ref={setNodeRef}
      style={{transform: CSS.Transform.toString(transform), transition}}
      data-testid="queue-item"
      className={`flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] p-[var(--space-2)] ${
        isCurrent ? 'bg-surface-raised' : 'hover:bg-surface'
      } ${isDragging ? 'relative z-10 opacity-80' : ''}`}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${track.title}`}
        // touch-none is required, not cosmetic: without it the browser claims
        // the gesture for scrolling and the drag never starts on a phone.
        className="flex h-11 w-11 shrink-0 touch-none items-center justify-center rounded-[var(--radius-md)] text-subtle hover:text-text cursor-grab active:cursor-grabbing"
      >
        <GripVertical size={16} aria-hidden />
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed 64x40 decorative thumbnail already served by YouTube's CDN; next/image would add a proxy hop and a layout wrapper to save nothing. */}
      <img
        src={track.thumbnail}
        alt=""
        loading="lazy"
        className="h-10 w-16 shrink-0 rounded-[var(--radius-sm)] object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text">{track.title}</p>
        <p className="truncate text-xs text-muted">
          {track.author} · {formatDuration(track.durationSec)} · added by {track.addedBy.name}
          {track.unplayable && ' · unavailable'}
        </p>
      </div>
      {isCurrent && <span className="shrink-0 text-xs font-medium text-live">playing</span>}
      <button
        onClick={() => onRemove(track.id)}
        aria-label={`Remove ${track.title}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-raised hover:text-text cursor-pointer"
      >
        <Trash2 size={16} aria-hidden />
      </button>
    </li>
  )
}
