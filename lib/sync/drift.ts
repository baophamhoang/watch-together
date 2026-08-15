import type {PlayerState} from '@/lib/youtube/use-player'
import type {Beat} from './types'

/**
 * Below this, a difference is not worth a seek. Raised from 0.5s, which sat
 * under YouTube's own reporting granularity and so fired on measurement noise
 * rather than on drift — every correction then caused buffering, which caused
 * more apparent drift, which caused another correction.
 */
export const DEAD_ZONE_S = 1.5
export const RESYNC_S = 3
export const CORRECTION_COOLDOWN_MS = 3000
/** Doubling stops here: 3s, 6s, 12s, 24s. */
export const MAX_BACKOFF_STEPS = 3
export const SEEK_SUPPRESSION_MS = 2000
export const DEFAULT_SEEK_LATENCY_MS = 300
/**
 * A seek-latency sample this large can only be a stale `pending` matching an
 * unrelated tick, not a real round trip — clamped rather than trusted, since
 * an inflated estimate feeds forward as lead compensation on the next seek.
 */
export const MAX_SEEK_LATENCY_MS = 2000

export type CorrectionInput = {
  expected: number
  actual: number
  isPlaying: boolean
  nowLocal: number
  lastCorrectionAt: number | null
  lastSeekAt: number | null
  seekLatencyMs: number
  playerState: PlayerState
  /** Corrections issued since drift was last inside the dead zone. */
  consecutiveCorrections: number
}

export type Correction =
  /**
   * `caughtUp` distinguishes the one do-nothing reason that means success —
   * drift inside the dead zone — from the three that mean "not yet": an
   * unsettled player, the post-seek suppression window, and the backoff wait.
   * The caller resets its streak on this and nothing else; keying off player
   * state instead resets during suppression, which caps the streak at 1 and
   * flattens the backoff it exists to grow.
   */
  | {kind: 'none'; caughtUp: boolean}
  | {kind: 'seek'; to: number; resyncing: boolean}

export function expectedPosition(beat: Beat, nowLocal: number, offsetMs: number): number {
  if (!beat.isPlaying) return beat.position
  return beat.position + (nowLocal + offsetMs - beat.hostClock) / 1000
}

export function decideCorrection(input: CorrectionInput): Correction {
  // Only a settled player can be measured. While buffering, `actual` is frozen
  // and `expected` keeps advancing, so the drift being computed is the
  // network's latency, not the peer's position — and seeking on it makes the
  // buffering worse.
  if (input.playerState !== 'playing' && input.playerState !== 'paused') {
    return {kind: 'none', caughtUp: false}
  }

  const drift = Math.abs(input.expected - input.actual)
  if (drift < DEAD_ZONE_S) return {kind: 'none', caughtUp: true}

  const since = (at: number | null) => (at === null ? Infinity : input.nowLocal - at)
  if (since(input.lastSeekAt) < SEEK_SUPPRESSION_MS) return {kind: 'none', caughtUp: false}

  // Each correction that fails to close the gap doubles the wait. A peer on a
  // slow link cannot win a forward-seek race, and retrying every three seconds
  // forever is the visible symptom the user reported.
  const backoff = CORRECTION_COOLDOWN_MS * 2 ** Math.min(input.consecutiveCorrections, MAX_BACKOFF_STEPS)
  if (since(input.lastCorrectionAt) < backoff) return {kind: 'none', caughtUp: false}

  // Seeking takes time to buffer; by the time playback resumes the target has
  // moved on, so aim slightly ahead. Only meaningful while the clock is running.
  const lead = input.isPlaying ? input.seekLatencyMs / 1000 : 0
  return {kind: 'seek', to: input.expected + lead, resyncing: drift > RESYNC_S}
}

export function nextStreak(correction: Correction, streak: number, targetMoved: boolean): number {
  // A moved target is not a failed correction — the room changed under us, and
  // the backoff earned against the old target says nothing about the new one.
  if (targetMoved) return 0
  if (correction.kind === 'seek') return streak + 1
  return correction.caughtUp ? 0 : streak
}
