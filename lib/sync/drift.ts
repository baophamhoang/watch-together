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
  | {kind: 'none'}
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
    return {kind: 'none'}
  }

  const drift = Math.abs(input.expected - input.actual)
  if (drift < DEAD_ZONE_S) return {kind: 'none'}

  const since = (at: number | null) => (at === null ? Infinity : input.nowLocal - at)
  if (since(input.lastSeekAt) < SEEK_SUPPRESSION_MS) return {kind: 'none'}

  // Each correction that fails to close the gap doubles the wait. A peer on a
  // slow link cannot win a forward-seek race, and retrying every three seconds
  // forever is the visible symptom the user reported.
  const backoff = CORRECTION_COOLDOWN_MS * 2 ** Math.min(input.consecutiveCorrections, MAX_BACKOFF_STEPS)
  if (since(input.lastCorrectionAt) < backoff) return {kind: 'none'}

  // Seeking takes time to buffer; by the time playback resumes the target has
  // moved on, so aim slightly ahead. Only meaningful while the clock is running.
  const lead = input.isPlaying ? input.seekLatencyMs / 1000 : 0
  return {kind: 'seek', to: input.expected + lead, resyncing: drift > RESYNC_S}
}
