import {describe, expect, it} from 'vitest'
import {bestOffset, CLOCK_WINDOW, makeSample, pushSample} from './clock'

describe('makeSample', () => {
  it('computes zero offset for symmetric delay and matched clocks', () => {
    // sent at 1000, host replied with 1050, received at 1100
    expect(makeSample(1000, 1050, 1100).offsetMs).toBe(0)
  })

  it('computes a positive offset when the host clock runs ahead', () => {
    expect(makeSample(1000, 6050, 1100).offsetMs).toBe(5000)
  })

  it('records the round trip', () => {
    expect(makeSample(1000, 1050, 1100).rttMs).toBe(100)
  })
})

describe('pushSample', () => {
  it('keeps only the most recent samples', () => {
    let window = [] as ReturnType<typeof makeSample>[]
    for (let i = 0; i < 8; i++) window = pushSample(window, makeSample(i, i, i + 2))
    expect(window).toHaveLength(CLOCK_WINDOW)
  })
})

describe('bestOffset', () => {
  it('returns null for an empty window', () => {
    expect(bestOffset([])).toBeNull()
  })

  it('prefers the sample with the lowest round trip', () => {
    const window = [
      {offsetMs: 900, rttMs: 400},
      {offsetMs: 100, rttMs: 20},
      {offsetMs: 700, rttMs: 250},
    ]
    expect(bestOffset(window)).toBe(100)
  })
})
