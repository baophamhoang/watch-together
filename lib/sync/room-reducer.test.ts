import {beforeEach, describe, expect, it} from 'vitest'
import {applyIntent, emptyRoomState} from './room-reducer'
import type {RoomState, Track} from './types'

const track = (id: string, startAtSec = 0): Track => ({
  id,
  videoId: `vid${id}`,
  title: `Title ${id}`,
  author: 'Author',
  thumbnail: 'https://example.test/t.jpg',
  durationSec: 100,
  startAtSec,
  addedBy: {peerId: 'p1', name: 'bao'},
  addedAt: 1000,
})

const withQueue = (ids: string[], current: string | null): RoomState => ({
  ...emptyRoomState(),
  queue: ids.map(id => track(id)),
  currentTrackId: current,
})

describe('applyIntent', () => {
  let state: RoomState

  beforeEach(() => {
    state = emptyRoomState()
  })

  it('bumps version on every change', () => {
    const next = applyIntent(state, {type: 'enqueue', track: track('a')}, 5000)
    expect(next.version).toBe(state.version + 1)
  })

  it('does not mutate the input state', () => {
    applyIntent(state, {type: 'enqueue', track: track('a')}, 5000)
    expect(state.queue).toHaveLength(0)
  })

  it('starts a room with no track runs recorded', () => {
    expect(emptyRoomState().trackRun).toBe(0)
  })

  it('starts playing the first enqueued track at its start offset', () => {
    const next = applyIntent(state, {type: 'enqueue', track: track('a', 30)}, 5000)
    expect(next.currentTrackId).toBe('a')
    expect(next.isPlaying).toBe(true)
    expect(next.position).toBe(30)
    expect(next.positionAt).toBe(5000)
    expect(next.trackRun).toBe(1)
  })

  it('appends without disturbing playback when a track is already current', () => {
    const first = applyIntent(state, {type: 'enqueue', track: track('a')}, 5000)
    const next = applyIntent(first, {type: 'enqueue', track: track('b')}, 6000)
    expect(next.currentTrackId).toBe('a')
    expect(next.queue.map(t => t.id)).toEqual(['a', 'b'])
    // Nothing started, so nothing may reload the player mid-song.
    expect(next.trackRun).toBe(first.trackRun)
  })

  it('allows the same video to be queued twice as distinct entries', () => {
    const a = {...track('a'), videoId: 'same'}
    const b = {...track('b'), videoId: 'same'}
    let next = applyIntent(state, {type: 'enqueue', track: a}, 5000)
    next = applyIntent(next, {type: 'enqueue', track: b}, 5001)
    expect(next.queue).toHaveLength(2)
  })

  it('records position and stops the clock on pause', () => {
    const next = applyIntent(withQueue(['a'], 'a'), {type: 'pause', position: 12.5}, 9000)
    expect(next.isPlaying).toBe(false)
    expect(next.position).toBe(12.5)
    expect(next.positionAt).toBe(9000)
  })

  it('restarts the clock on play without moving position', () => {
    const paused = applyIntent(withQueue(['a'], 'a'), {type: 'pause', position: 12.5}, 9000)
    const next = applyIntent(paused, {type: 'play'}, 11000)
    expect(next.isPlaying).toBe(true)
    expect(next.position).toBe(12.5)
    expect(next.positionAt).toBe(11000)
  })

  // The guard in useSyncPlayback reloads the video whenever `trackRun` moves,
  // so any spurious bump here would restart the video on an ordinary pause,
  // play, seek or reorder — the mirror image of the bug `trackRun` fixes.
  it('leaves trackRun alone on play, pause, seek and reorder', () => {
    const base = withQueue(['a', 'b'], 'a')
    for (const intent of [
      {type: 'pause', position: 12.5},
      {type: 'play'},
      {type: 'seek', position: 40},
      {type: 'reorder', trackId: 'b', toIndex: 0},
    ] as const) {
      expect(applyIntent(base, intent, 9000).trackRun).toBe(base.trackRun)
    }
  })

  it('moves to the next track on skip', () => {
    const base = withQueue(['a', 'b'], 'a')
    const next = applyIntent(base, {type: 'skip'}, 9000)
    expect(next.currentTrackId).toBe('b')
    expect(next.position).toBe(0)
    expect(next.trackRun).toBe(base.trackRun + 1)
  })

  it('wraps to the first track when skipping the last', () => {
    const next = applyIntent(withQueue(['a', 'b'], 'b'), {type: 'skip'}, 9000)
    expect(next.currentTrackId).toBe('a')
  })

  it('advances on ended only for the current track', () => {
    const base = withQueue(['a', 'b'], 'a')
    expect(applyIntent(base, {type: 'ended', trackId: 'b'}, 9000)).toBe(base)
    expect(applyIntent(base, {type: 'ended', trackId: 'a'}, 9000).currentTrackId).toBe('b')
  })

  // The single-track restart. `nextTrackId` wraps a one-entry queue to itself,
  // so `currentTrackId` is identical either side of this transition and cannot
  // tell the player anything happened — which is exactly how the video used to
  // stay frozen on its last frame while the room insisted it was playing from
  // the top. `trackRun` is the only thing in the state that moves here.
  it('restarts a single-track queue on ended, advancing trackRun', () => {
    const base = withQueue(['a'], 'a')
    const next = applyIntent(base, {type: 'ended', trackId: 'a'}, 9000)
    expect(next.currentTrackId).toBe('a')
    expect(next.trackRun).toBeGreaterThan(base.trackRun)
    expect(next.isPlaying).toBe(true)
    expect(next.position).toBe(0)
    expect(next.positionAt).toBe(9000)
  })

  it('advances then removes when the current track is removed', () => {
    const base = withQueue(['a', 'b'], 'a')
    const next = applyIntent(base, {type: 'remove', trackId: 'a'}, 9000)
    expect(next.currentTrackId).toBe('b')
    expect(next.queue.map(t => t.id)).toEqual(['b'])
    expect(next.trackRun).toBe(base.trackRun + 1)
  })

  it('empties the room when the last track is removed', () => {
    const next = applyIntent(withQueue(['a'], 'a'), {type: 'remove', trackId: 'a'}, 9000)
    expect(next.queue).toHaveLength(0)
    expect(next.currentTrackId).toBeNull()
    expect(next.isPlaying).toBe(false)
    expect(next.position).toBe(0)
    // A room with nothing in it is a fresh room, counter included. Safe because
    // `currentTrackId` is null here too, which is what makes the player forget
    // whatever it had loaded — the counter is never read on its own.
    expect(next.trackRun).toBe(0)
  })

  it('leaves playback alone when removing a non-current track', () => {
    const base = withQueue(['a', 'b'], 'a')
    const next = applyIntent(base, {type: 'remove', trackId: 'b'}, 9000)
    expect(next.currentTrackId).toBe('a')
    expect(next.queue.map(t => t.id)).toEqual(['a'])
    expect(next.trackRun).toBe(base.trackRun)
  })

  it('reorders a track to a new index', () => {
    const next = applyIntent(
      withQueue(['a', 'b', 'c'], 'a'),
      {type: 'reorder', trackId: 'c', toIndex: 0},
      9000,
    )
    expect(next.queue.map(t => t.id)).toEqual(['c', 'a', 'b'])
  })

  it('clamps an out-of-range reorder index', () => {
    const next = applyIntent(
      withQueue(['a', 'b'], 'a'),
      {type: 'reorder', trackId: 'a', toIndex: 99},
      9000,
    )
    expect(next.queue.map(t => t.id)).toEqual(['b', 'a'])
  })

  it('marks a track unplayable and skips past it when it is current', () => {
    const base = withQueue(['a', 'b'], 'a')
    const next = applyIntent(
      base,
      {type: 'unplayable', trackId: 'a', reason: 'embed-blocked'},
      9000,
    )
    expect(next.queue[0].unplayable).toBe('embed-blocked')
    expect(next.currentTrackId).toBe('b')
    expect(next.trackRun).toBe(base.trackRun + 1)
  })

  it('stops playback when the only track is marked unplayable', () => {
    const base = withQueue(['a'], 'a')
    const next = applyIntent(
      base,
      {type: 'unplayable', trackId: 'a', reason: 'embed-blocked'},
      9000,
    )
    expect(next.queue[0].unplayable).toBe('embed-blocked')
    expect(next.isPlaying).toBe(false)
    // Nothing started, so nothing must reload — otherwise the player would be
    // told to re-fetch the very video it just reported it cannot play.
    expect(next.trackRun).toBe(base.trackRun)
  })

  it('skips over already-unplayable tracks instead of looping', () => {
    let state = withQueue(['a', 'b', 'c'], 'a')
    state = applyIntent(state, {type: 'unplayable', trackId: 'b', reason: 'embed-blocked'}, 9000)
    const next = applyIntent(state, {type: 'unplayable', trackId: 'a', reason: 'embed-blocked'}, 9500)
    expect(next.currentTrackId).toBe('c')
  })

  it('ignores intents referencing unknown tracks', () => {
    const base = withQueue(['a'], 'a')
    expect(applyIntent(base, {type: 'remove', trackId: 'ghost'}, 9000)).toBe(base)
  })
})
