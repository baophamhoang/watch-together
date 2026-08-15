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
  const consecutiveCorrections = useRef(0)
  const lastSeekAt = useRef<number | null>(null)
  const seekLatencyMs = useRef(DEFAULT_SEEK_LATENCY_MS)
  const inFlightSeek = useRef<{target: number; startedAt: number} | null>(null)
  const loadedTrackId = useRef<string | null>(null)
  /** `state.trackRun` at the moment `loadedTrackId` was loaded. -1 is a run
   *  number the reducer never issues, so nothing is ever mistaken for loaded. */
  const loadedRun = useRef(-1)
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

  // Load whenever the room moves to a different queue entry — OR restarts the
  // one it is already on. The id alone is not enough to spot the second case: a
  // one-track queue wraps to itself when the video ends, so `currentTrackId` is
  // unchanged while the reducer has genuinely rewound the room to `startAtSec`.
  // Bailing on the id alone left the player parked on the final frame while the
  // room claimed position 0 and playing — and only guests could recover, by
  // drift-correcting; the host never corrects itself, so it stayed stuck until
  // someone hit skip. `state.trackRun` is the discriminator (`positionAt` is
  // not: it also moves on play, pause and seek, so keying on it would reload
  // the video every time anyone hit pause).
  useEffect(() => {
    if (!handle || !current) return
    if (loadedTrackId.current === current.id && loadedRun.current === state.trackRun) return
    loadedTrackId.current = current.id
    loadedRun.current = state.trackRun
    handle.load(current.videoId, state.position)
    lastSeekAt.current = Date.now()
  }, [handle, current, state.position, state.trackRun])

  // Follow the authoritative play/pause flag. Unlike the load effect above,
  // `!current` must NOT bail out here: removing the last queued track sets
  // `current` to null, and if nothing calls pause() the player keeps playing
  // the just-removed video forever on every peer. Reset `loadedTrackId` too,
  // so a later re-add loads cleanly instead of being mistaken for the track
  // already "loaded".
  //
  // Depends on `current?.id`, not `current`: on a guest, `current` is derived
  // from freshly deserialized state on every host broadcast (any intent, not
  // just ones affecting this track), so the object reference changes far more
  // often than the track itself does. Depending on the whole object made this
  // effect re-run on every broadcast, each run calling handle.play()/pause()
  // again and re-extending use-player's suppression window — long enough to
  // swallow a genuine user play/pause near any queue change. `current?.id` is
  // the only part of `current` this effect reads, so it's also the only part
  // that belongs in the dependency array.
  useEffect(() => {
    if (!handle) return
    if (!current?.id) {
      handle.pause()
      loadedTrackId.current = null
      return
    }
    if (state.isPlaying) handle.play()
    else handle.pause()
  }, [handle, current?.id, state.isPlaying])

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
        playerState: handle.getState(),
        consecutiveCorrections: consecutiveCorrections.current,
      })

      if (correction.kind === 'none') {
        // A settled player inside the dead zone is the definition of caught up.
        // Buffering ticks also return 'none', and must NOT reset the streak —
        // that would restart the doubling every time the network hiccuped and
        // reintroduce the loop this exists to break.
        const settled = handle.getState() === 'playing' || handle.getState() === 'paused'
        if (settled) consecutiveCorrections.current = 0
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
      consecutiveCorrections.current += 1
      inFlightSeek.current = {target: correction.to, startedAt: now}
      setResyncing(correction.resyncing)
    }, CHECK_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [handle, room.isHost])

  return {resyncing, current}
}
