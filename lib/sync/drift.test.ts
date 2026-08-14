import {describe, expect, it} from 'vitest'
import {
  CORRECTION_COOLDOWN_MS,
  decideCorrection,
  expectedPosition,
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
    expect(decideCorrection({...base, actual: 99.4}).kind).toBe('seek')
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
    const result = decideCorrection({...base, actual: 99})
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
