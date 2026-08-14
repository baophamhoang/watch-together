import type {Beat} from './types'

export const DEAD_ZONE_S = 0.5
export const RESYNC_S = 2
export const CORRECTION_COOLDOWN_MS = 3000
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
}

export type Correction =
  | {kind: 'none'}
  | {kind: 'seek'; to: number; resyncing: boolean}

export function expectedPosition(beat: Beat, nowLocal: number, offsetMs: number): number {
  if (!beat.isPlaying) return beat.position
  return beat.position + (nowLocal + offsetMs - beat.hostClock) / 1000
}

export function decideCorrection(input: CorrectionInput): Correction {
  const drift = Math.abs(input.expected - input.actual)
  if (drift < DEAD_ZONE_S) return {kind: 'none'}

  const since = (at: number | null) => (at === null ? Infinity : input.nowLocal - at)
  if (since(input.lastSeekAt) < SEEK_SUPPRESSION_MS) return {kind: 'none'}
  if (since(input.lastCorrectionAt) < CORRECTION_COOLDOWN_MS) return {kind: 'none'}

  // Seeking takes time to buffer; by the time playback resumes the target has
  // moved on, so aim slightly ahead. Only meaningful while the clock is running.
  const lead = input.isPlaying ? input.seekLatencyMs / 1000 : 0
  return {kind: 'seek', to: input.expected + lead, resyncing: drift > RESYNC_S}
}
