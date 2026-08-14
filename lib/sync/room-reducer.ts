import type {Intent, RoomState, Track} from './types'

export function emptyRoomState(): RoomState {
  return {
    version: 0,
    queue: [],
    currentTrackId: null,
    isPlaying: false,
    position: 0,
    positionAt: 0,
  }
}

function nextTrackId(queue: Track[], currentId: string | null): string | null {
  if (queue.length === 0) return null
  const index = queue.findIndex(t => t.id === currentId)
  if (index === -1) return queue[0].id
  return queue[(index + 1) % queue.length].id
}

function startTrack(state: RoomState, trackId: string | null, now: number): RoomState {
  const track = state.queue.find(t => t.id === trackId)
  return {
    ...state,
    currentTrackId: trackId,
    position: track?.startAtSec ?? 0,
    positionAt: now,
    isPlaying: trackId !== null,
  }
}

export function applyIntent(state: RoomState, intent: Intent, now: number): RoomState {
  const bump = (next: Omit<RoomState, 'version'>): RoomState =>
    ({...next, version: state.version + 1})

  switch (intent.type) {
    case 'enqueue': {
      const queue = [...state.queue, intent.track]
      const isFirst = state.currentTrackId === null
      return bump(isFirst
        ? startTrack({...state, queue}, intent.track.id, now)
        : {...state, queue})
    }

    case 'play':
      if (state.currentTrackId === null) return state
      return bump({...state, isPlaying: true, positionAt: now})

    case 'pause':
      if (state.currentTrackId === null) return state
      return bump({...state, isPlaying: false, position: intent.position, positionAt: now})

    case 'seek':
      if (state.currentTrackId === null) return state
      return bump({...state, position: intent.position, positionAt: now})

    case 'skip':
      if (state.currentTrackId === null) return state
      return bump(startTrack(state, nextTrackId(state.queue, state.currentTrackId), now))

    case 'ended':
      if (intent.trackId !== state.currentTrackId) return state
      return bump(startTrack(state, nextTrackId(state.queue, state.currentTrackId), now))

    case 'remove': {
      if (!state.queue.some(t => t.id === intent.trackId)) return state
      const isCurrent = intent.trackId === state.currentTrackId
      const advanced = isCurrent
        ? startTrack(state, nextTrackId(state.queue, state.currentTrackId), now)
        : state
      const queue = advanced.queue.filter(t => t.id !== intent.trackId)
      if (queue.length === 0) return bump(emptyRoomState())
      const currentTrackId = advanced.currentTrackId === intent.trackId
        ? queue[0].id
        : advanced.currentTrackId
      return bump({...advanced, queue, currentTrackId})
    }

    case 'reorder': {
      const from = state.queue.findIndex(t => t.id === intent.trackId)
      if (from === -1) return state
      const queue = [...state.queue]
      const [moved] = queue.splice(from, 1)
      const to = Math.max(0, Math.min(intent.toIndex, queue.length))
      queue.splice(to, 0, moved)
      return bump({...state, queue})
    }

    case 'unplayable': {
      if (!state.queue.some(t => t.id === intent.trackId)) return state
      const queue = state.queue.map(t =>
        t.id === intent.trackId ? {...t, unplayable: intent.reason} : t)
      const marked = {...state, queue}
      return bump(intent.trackId === state.currentTrackId
        ? startTrack(marked, nextTrackId(queue, state.currentTrackId), now)
        : marked)
    }
  }
}
