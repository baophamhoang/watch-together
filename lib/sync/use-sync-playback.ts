'use client'

import {useEffect, useRef, useState} from 'react'
import {
  decideCorrection,
  DEFAULT_SEEK_LATENCY_MS,
  expectedPosition,
  MAX_SEEK_LATENCY_MS,
  nextStreak,
  RESYNC_S,
} from './drift'
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
  /** `beat.version` last seen by the correction interval. -1 is a version the
   *  reducer never issues, so the first tick always counts as a fresh target —
   *  harmless, since the streak it would reset is already 0 on the first tick. */
  const lastBeatVersion = useRef(-1)
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
      const expected = expectedPosition(beat, now, offsetMs)
      const drift = Math.abs(expected - actual)

      // A scrub, play/pause, skip or track change all bump `beat.version`, and
      // nothing else does. Compared and refreshed every tick, so this is true
      // for exactly the one tick that observes a change — read by nextStreak
      // below, since a moved target invalidates whatever backoff was earned
      // against the old one.
      const targetMoved = beat.version !== lastBeatVersion.current
      lastBeatVersion.current = beat.version

      // Measure how long the last seek took so the next one aims correctly.
      // Reject a landing more than two ticks old: with corrections now up to
      // 24s apart, a `pending` left over from several ticks ago could
      // otherwise match an unrelated later tick's position by coincidence and
      // feed a wildly inflated latency into the estimate. Clamped below as a
      // second guard, since a bad sample that slips through would then persist
      // for however many corrections — now up to 24s apart — the EMA takes to
      // recover.
      const pending = inFlightSeek.current
      if (
        pending &&
        now - pending.startedAt < 2 * CHECK_INTERVAL_MS &&
        Math.abs(actual - pending.target) < LANDED_TOLERANCE_S
      ) {
        const observed = now - pending.startedAt
        seekLatencyMs.current = Math.min(
          Math.round((seekLatencyMs.current + observed) / 2),
          MAX_SEEK_LATENCY_MS,
        )
        inFlightSeek.current = null
      }

      const correction = decideCorrection({
        expected,
        actual,
        isPlaying: beat.isPlaying,
        nowLocal: now,
        lastCorrectionAt: lastCorrectionAt.current,
        lastSeekAt: lastSeekAt.current,
        seekLatencyMs: seekLatencyMs.current,
        playerState: handle.getState(),
        consecutiveCorrections: consecutiveCorrections.current,
      })

      consecutiveCorrections.current = nextStreak(correction, consecutiveCorrections.current, targetMoved)

      if (correction.kind === 'none') {
        // A pending seek that never landed within the window above would
        // otherwise sit here until the next seek overwrites it — now up to
        // 24s away instead of ~3s. Cleared unconditionally so a stale entry
        // can't survive that long only to match some unrelated later tick.
        inFlightSeek.current = null
        // Same-value updates bail out of a re-render (React dedupes via
        // Object.is), so this is safe to call unconditionally — and it must
        // be unconditional: `resyncing` is deliberately not a dependency
        // below, so a closed-over read of it here would be stale.
        setResyncing(!correction.caughtUp && drift > RESYNC_S)
        return
      }

      handle.seekTo(correction.to)
      lastCorrectionAt.current = now
      lastSeekAt.current = now
      inFlightSeek.current = {target: correction.to, startedAt: now}
      setResyncing(drift > RESYNC_S)
    }, CHECK_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [handle, room.isHost])

  return {resyncing, current}
}
