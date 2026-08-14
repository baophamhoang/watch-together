export type Unplayable = 'embed-blocked' | 'not-found'

export type Track = {
  id: string
  videoId: string
  title: string
  author: string
  thumbnail: string
  durationSec: number | null
  startAtSec: number
  addedBy: {peerId: string; name: string}
  addedAt: number
  unplayable?: Unplayable
}

export type RoomState = {
  version: number
  queue: Track[]
  currentTrackId: string | null
  isPlaying: boolean
  position: number
  positionAt: number
}

export type Intent =
  | {type: 'play'}
  | {type: 'pause'; position: number}
  | {type: 'seek'; position: number}
  | {type: 'skip'}
  | {type: 'enqueue'; track: Track}
  | {type: 'remove'; trackId: string}
  | {type: 'reorder'; trackId: string; toIndex: number}
  | {type: 'ended'; trackId: string}
  | {type: 'unplayable'; trackId: string; reason: Unplayable}

export type RosterEntry = {peerId: string; name: string; joinOrder: number}

export type Beat = {
  version: number
  currentTrackId: string | null
  isPlaying: boolean
  position: number
  hostClock: number
}
