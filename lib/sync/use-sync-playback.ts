'use client'

import {useEffect, useRef, useState} from 'react'
import {decideCorrection, DEFAULT_SEEK_LATENCY_MS, expectedPosition} from './drift'
import type {RoomApi} from './use-room'
import type {Track} from './types'
import type {PlayerHandle} from '@/lib/youtube/use-player'

const CHECK_INTERVAL_MS = 1000
/** Distance at which a seek counts as landed, for latency measurement. */
const LANDED_TOLERANCE_S = 0.5

export function useSyncPlayback(room: RoomApi, handle: PlayerHandle | null) {
  const lastCorrectionAt = useRef<number | null>(null)
  const lastSeekAt = useRef<number | null>(null)
  const seekLatencyMs = useRef(DEFAULT_SEEK_LATENCY_MS)
  const inFlightSeek = useRef<{target: number; startedAt: number} | null>(null)
  const loadedTrackId = useRef<string | null>(null)
  const [resyncing, setResyncing] = useState(false)

  // `useRoom` returns a fresh object literal on every render. The drift-check
  // interval below must not depend on `room` itself, or beats arriving every
  // ~2s would tear down and rebuild the interval constantly. Refresh a ref
  // every render instead, so the interval always reads the latest beat/offset
  // without forcing a rebuild.
  const roomRef = useRef(room)
  useEffect(() => {
    roomRef.current = room
  })

  const {state} = room
  const current: Track | null =
    state.queue.find(track => track.id === state.currentTrackId) ?? null

  // Load whenever the room moves to a different queue entry.
  useEffect(() => {
    if (!handle || !current) return
    if (loadedTrackId.current === current.id) return
    loadedTrackId.current = current.id
    handle.load(current.videoId, state.position)
    lastSeekAt.current = Date.now()
  }, [handle, current, state.position])

  // Follow the authoritative play/pause flag. Unlike the load effect above,
  // `!current` must NOT bail out here: removing the last queued track sets
  // `current` to null, and if nothing calls pause() the player keeps playing
  // the just-removed video forever on every peer. Reset `loadedTrackId` too,
  // so a later re-add loads cleanly instead of being mistaken for the track
  // already "loaded".
  useEffect(() => {
    if (!handle) return
    if (!current) {
      handle.pause()
      loadedTrackId.current = null
      return
    }
    if (state.isPlaying) handle.play()
    else handle.pause()
  }, [handle, current, state.isPlaying])

  // Guests correct drift against the host's heartbeat. The host defines truth
  // and therefore never corrects itself.
  useEffect(() => {
    if (!handle || room.isHost) return

    const timer = setInterval(() => {
      const {beat, offsetMs} = roomRef.current
      if (!beat || offsetMs === null) return
      if (beat.currentTrackId !== loadedTrackId.current) return

      const now = Date.now()
      const actual = handle.getCurrentTime()

      // Measure how long the last seek took so the next one aims correctly.
      const pending = inFlightSeek.current
      if (pending && Math.abs(actual - pending.target) < LANDED_TOLERANCE_S) {
        const observed = now - pending.startedAt
        seekLatencyMs.current = Math.round((seekLatencyMs.current + observed) / 2)
        inFlightSeek.current = null
      }

      const correction = decideCorrection({
        expected: expectedPosition(beat, now, offsetMs),
        actual,
        isPlaying: beat.isPlaying,
        nowLocal: now,
        lastCorrectionAt: lastCorrectionAt.current,
        lastSeekAt: lastSeekAt.current,
        seekLatencyMs: seekLatencyMs.current,
      })

      if (correction.kind === 'none') {
        // Same-value updates bail out of a re-render (React dedupes via
        // Object.is), so this is safe to call unconditionally — and it must
        // be unconditional: `resyncing` is deliberately not a dependency
        // below, so a closed-over read of it here would be stale.
        setResyncing(false)
        return
      }

      handle.seekTo(correction.to)
      lastCorrectionAt.current = now
      lastSeekAt.current = now
      inFlightSeek.current = {target: correction.to, startedAt: now}
      setResyncing(correction.resyncing)
    }, CHECK_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [handle, room.isHost])

  return {resyncing, current}
}
