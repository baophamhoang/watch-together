import {describe, expect, it} from 'vitest'
import {formatDuration} from './format-duration'

describe('formatDuration', () => {
  it.each([
    [null, '—'],
    [0, '0:00'],
    [9, '0:09'],
    [213, '3:33'],
    [600, '10:00'],
    [3600, '1:00:00'],
    [3723, '1:02:03'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected)
  })

  it('rounds fractional seconds down', () => {
    expect(formatDuration(213.9)).toBe('3:33')
  })
})
