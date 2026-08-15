import {describe, expect, it} from 'vitest'
import {
  CORRECTION_COOLDOWN_MS,
  MAX_BACKOFF_STEPS,
  decideCorrection,
  expectedPosition,
  nextStreak,
  type Correction,
  type CorrectionInput,
} from './drift'

const base: CorrectionInput = {
  expected: 100,
  actual: 100,
  isPlaying: true,
  nowLocal: 1_000_000,
  lastCorrectionAt: null,
  lastSeekAt: null,
  seekLatencyMs: 300,
  playerState: 'playing',
  consecutiveCorrections: 0,
}

describe('expectedPosition', () => {
  const beat = {
    version: 1,
    currentTrackId: 't',
    isPlaying: true,
    position: 50,
    hostClock: 1000,
  }

  it('advances position by elapsed host time while playing', () => {
    // local clock is 5000ms behind the host, so offset is +5000
    expect(expectedPosition(beat, -1000, 5000)).toBe(53)
  })

  it('holds position while paused', () => {
    expect(expectedPosition({...beat, isPlaying: false}, 99_999, 0)).toBe(50)
  })
})

describe('decideCorrection', () => {
  it('does nothing inside the dead zone', () => {
    expect(decideCorrection({...base, actual: 100.4}).kind).toBe('none')
  })

  it('corrects just outside the dead zone', () => {
    // DEAD_ZONE_S is 1.5; 98.4 is a drift of 1.6, just past the boundary.
    expect(decideCorrection({...base, actual: 98.4}).kind).toBe('seek')
  })

  it('adds lead compensation when playing', () => {
    const result = decideCorrection({...base, actual: 90})
    expect(result).toEqual({kind: 'seek', to: 100.3, resyncing: true})
  })

  it('omits lead compensation when paused', () => {
    const result = decideCorrection({...base, actual: 90, isPlaying: false})
    expect(result).toEqual({kind: 'seek', to: 100, resyncing: true})
  })

  it('flags small corrections as not resyncing', () => {
    // Drift of 2: past the 1.5 dead zone but under the 3s resync threshold.
    const result = decideCorrection({...base, actual: 98})
    expect(result).toMatchObject({kind: 'seek', resyncing: false})
  })

  it('suppresses corrections shortly after a seek', () => {
    const result = decideCorrection({...base, actual: 90, lastSeekAt: base.nowLocal - 500})
    expect(result.kind).toBe('none')
  })

  it('allows corrections once the seek suppression window passes', () => {
    const result = decideCorrection({...base, actual: 90, lastSeekAt: base.nowLocal - 2500})
    expect(result.kind).toBe('seek')
  })

  it('respects the correction cooldown', () => {
    const result = decideCorrection({
      ...base,
      actual: 90,
      lastCorrectionAt: base.nowLocal - (CORRECTION_COOLDOWN_MS - 100),
    })
    expect(result.kind).toBe('none')
  })

  it('corrects again after the cooldown expires', () => {
    const result = decideCorrection({
      ...base,
      actual: 90,
      lastCorrectionAt: base.nowLocal - (CORRECTION_COOLDOWN_MS + 100),
    })
    expect(result.kind).toBe('seek')
  })
})

describe('decideCorrection — network awareness', () => {
  // The spiral this exists to break: a seek causes buffering, buffering stops
  // `actual` advancing while `expected` keeps running on the clock, so drift
  // grows and triggers another seek. Correcting while buffering measures the
  // network, not the drift.
  it('never corrects while the player is buffering', () => {
    expect(
      decideCorrection({...base, playerState: 'buffering', expected: 100, actual: 0}),
    ).toEqual({kind: 'none', caughtUp: false})
  })

  it('never corrects before the player has started', () => {
    expect(
      decideCorrection({...base, playerState: 'unstarted', expected: 100, actual: 0}),
    ).toEqual({kind: 'none', caughtUp: false})
  })

  it('still corrects a paused player, which is a legitimate steady state', () => {
    const out = decideCorrection({
      ...base,
      playerState: 'paused',
      isPlaying: false,
      expected: 100,
      actual: 0,
    })
    expect(out.kind).toBe('seek')
  })

  // Each unsuccessful correction doubles the wait. A guest that cannot keep up
  // should give up gracefully rather than seek every three seconds forever.
  it('backs off exponentially while corrections are not landing', () => {
    const at = (consecutiveCorrections: number, sinceMs: number) =>
      decideCorrection({
        ...base,
        consecutiveCorrections,
        expected: 100,
        actual: 0,
        nowLocal: base.nowLocal,
        lastCorrectionAt: base.nowLocal - sinceMs,
      }).kind

    expect(at(0, 3500)).toBe('seek')
    expect(at(1, 3500)).toBe('none')
    expect(at(1, 6500)).toBe('seek')
    expect(at(2, 6500)).toBe('none')
    expect(at(2, 12500)).toBe('seek')
  })

  it('caps the backoff rather than growing without bound', () => {
    const out = decideCorrection({
      ...base,
      consecutiveCorrections: 99,
      expected: 100,
      actual: 0,
      lastCorrectionAt: base.nowLocal - (CORRECTION_COOLDOWN_MS * 2 ** MAX_BACKOFF_STEPS + 500),
    })
    expect(out.kind).toBe('seek')
  })

  // The cap test above proves the backoff doesn't grow past 24s; this pins it
  // from below, so the cap is a ceiling and not also a floor that fires early.
  it('still waits out the capped backoff, even at a very high streak', () => {
    const out = decideCorrection({
      ...base,
      consecutiveCorrections: 99,
      expected: 100,
      actual: 0,
      lastCorrectionAt: base.nowLocal - 23_500,
    })
    expect(out.kind).toBe('none')
  })

  // The old dead zone was 0.5s, below YouTube's own reporting granularity, so
  // it fired on noise. A tolerance must exceed the noise floor of the thing it
  // measures.
  it('tolerates drift that is real but not worth a seek', () => {
    expect(decideCorrection({...base, expected: 101, actual: 100}).kind).toBe('none')
  })

  // `caughtUp` is what the streak reset keys on. Pinning all four `none`
  // reasons here because the backoff's entire correctness depends on only one
  // of them being true.
  it('reports caught up when the drift is genuinely inside the dead zone', () => {
    expect(decideCorrection({...base, expected: 100, actual: 100})).toEqual({
      kind: 'none',
      caughtUp: true,
    })
  })

  it('does not report caught up while buffering', () => {
    expect(
      decideCorrection({...base, playerState: 'buffering', expected: 100, actual: 0}),
    ).toEqual({kind: 'none', caughtUp: false})
  })

  it('does not report caught up while suppressed after a seek', () => {
    expect(
      decideCorrection({
        ...base,
        expected: 100,
        actual: 0,
        lastSeekAt: base.nowLocal - 500,
      }),
    ).toEqual({kind: 'none', caughtUp: false})
  })

  it('does not report caught up while backing off', () => {
    expect(
      decideCorrection({
        ...base,
        expected: 100,
        actual: 0,
        consecutiveCorrections: 2,
        lastCorrectionAt: base.nowLocal - 4000,
      }),
    ).toEqual({kind: 'none', caughtUp: false})
  })
})

describe('nextStreak', () => {
  const seek: Correction = {kind: 'seek', to: 100, resyncing: false}
  const caughtUp: Correction = {kind: 'none', caughtUp: true}
  const notYet: Correction = {kind: 'none', caughtUp: false}

  it('increments on a seek', () => {
    expect(nextStreak(seek, 2, false)).toBe(3)
  })

  it('resets to zero on genuine catch-up', () => {
    expect(nextStreak(caughtUp, 5, false)).toBe(0)
  })

  it('holds steady while waiting — not caught up, but not a new failure either', () => {
    expect(nextStreak(notYet, 3, false)).toBe(3)
  })

  it('resets to zero when the target moved, even mid-wait', () => {
    expect(nextStreak(notYet, 7, true)).toBe(0)
  })

  // The override applies regardless of what correction fired this same tick —
  // a moved target isn't just "not a failure", it makes the seek that follows
  // it a fresh first attempt, not a continuation of the old streak.
  it('resets to zero when the target moved, even overriding a seek', () => {
    expect(nextStreak(seek, 9, true)).toBe(0)
  })
})
