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

  it('starts playing the first enqueued track at its start offset', () => {
    const next = applyIntent(state, {type: 'enqueue', track: track('a', 30)}, 5000)
    expect(next.currentTrackId).toBe('a')
    expect(next.isPlaying).toBe(true)
    expect(next.position).toBe(30)
    expect(next.positionAt).toBe(5000)
  })

  it('appends without disturbing playback when a track is already current', () => {
    const first = applyIntent(state, {type: 'enqueue', track: track('a')}, 5000)
    const next = applyIntent(first, {type: 'enqueue', track: track('b')}, 6000)
    expect(next.currentTrackId).toBe('a')
    expect(next.queue.map(t => t.id)).toEqual(['a', 'b'])
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

  it('moves to the next track on skip', () => {
    const next = applyIntent(withQueue(['a', 'b'], 'a'), {type: 'skip'}, 9000)
    expect(next.currentTrackId).toBe('b')
    expect(next.position).toBe(0)
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

  it('advances then removes when the current track is removed', () => {
    const next = applyIntent(withQueue(['a', 'b'], 'a'), {type: 'remove', trackId: 'a'}, 9000)
    expect(next.currentTrackId).toBe('b')
    expect(next.queue.map(t => t.id)).toEqual(['b'])
  })

  it('empties the room when the last track is removed', () => {
    const next = applyIntent(withQueue(['a'], 'a'), {type: 'remove', trackId: 'a'}, 9000)
    expect(next.queue).toHaveLength(0)
    expect(next.currentTrackId).toBeNull()
    expect(next.isPlaying).toBe(false)
    expect(next.position).toBe(0)
  })

  it('leaves playback alone when removing a non-current track', () => {
    const next = applyIntent(withQueue(['a', 'b'], 'a'), {type: 'remove', trackId: 'b'}, 9000)
    expect(next.currentTrackId).toBe('a')
    expect(next.queue.map(t => t.id)).toEqual(['a'])
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
    const next = applyIntent(
      withQueue(['a', 'b'], 'a'),
      {type: 'unplayable', trackId: 'a', reason: 'embed-blocked'},
      9000,
    )
    expect(next.queue[0].unplayable).toBe('embed-blocked')
    expect(next.currentTrackId).toBe('b')
  })

  it('ignores intents referencing unknown tracks', () => {
    const base = withQueue(['a'], 'a')
    expect(applyIntent(base, {type: 'remove', trackId: 'ghost'}, 9000)).toBe(base)
  })
})
