import {describe, expect, it} from 'vitest'
import {generateRoomCode, isValidRoomCode} from './room-code'

describe('generateRoomCode', () => {
  it('produces a code that validates', () => {
    expect(isValidRoomCode(generateRoomCode())).toBe(true)
  })

  it('produces the adjective-noun-suffix shape', () => {
    expect(generateRoomCode()).toMatch(/^[a-z]+-[a-z]+-[0-9a-z]{4}$/)
  })

  it('is deterministic given a seeded random source', () => {
    const always = () => 0
    expect(generateRoomCode(always)).toBe(generateRoomCode(always))
  })

  it('varies across calls', () => {
    const codes = new Set(Array.from({length: 50}, () => generateRoomCode()))
    expect(codes.size).toBeGreaterThan(45)
  })

  it('still produces a valid code when random() returns its exclusive bound', () => {
    expect(isValidRoomCode(generateRoomCode(() => 1))).toBe(true)
  })
})

describe('isValidRoomCode', () => {
  it.each(['ember-otter-k7qm', 'quiet-lantern-2b9x'])('accepts %s', code => {
    expect(isValidRoomCode(code)).toBe(true)
  })

  it.each([
    'ember-otter',
    'ember-otter-k7q',
    'ember-otter-k7qmm',
    'Ember-Otter-k7qm',
    'ember otter k7qm',
    '../../etc/passwd',
    '',
  ])('rejects %s', code => {
    expect(isValidRoomCode(code)).toBe(false)
  })

  it('rejects the join field placeholder text', () => {
    // The placeholder must have the same shape as a real code (so it reads as
    // an example) while failing validation itself — otherwise submitting the
    // field unchanged silently joins a real, shared room. Keep this in sync
    // with the placeholder in app/page.tsx.
    expect(isValidRoomCode('word-word-abcd')).toBe(false)
  })
})
