export type ClockSample = {offsetMs: number; rttMs: number}

export const CLOCK_WINDOW = 5

/**
 * NTP-style offset: assumes the request and response legs took equal time,
 * so the host's clock at the midpoint of the round trip is comparable to ours.
 */
export function makeSample(t0: number, hostClock: number, t2: number): ClockSample {
  return {offsetMs: hostClock - (t0 + t2) / 2, rttMs: t2 - t0}
}

export function pushSample(
  window: ClockSample[],
  sample: ClockSample,
  max: number = CLOCK_WINDOW,
): ClockSample[] {
  return [...window, sample].slice(-max)
}

/** The lowest-RTT sample carries the least asymmetric-delay error. */
export function bestOffset(window: ClockSample[]): number | null {
  if (window.length === 0) return null
  return window.reduce((best, s) => (s.rttMs < best.rttMs ? s : best)).offsetMs
}
