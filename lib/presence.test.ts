import {describe, expect, it} from 'vitest'
import {avatarFor, diffRoster} from './presence'
import type {RosterEntry} from './sync/types'

const peer = (peerId: string, name = peerId): RosterEntry => ({peerId, name, joinOrder: 0})

describe('avatarFor', () => {
  it('uses the first character of the name, uppercased', () => {
    expect(avatarFor('abc', 'bao').initial).toBe('B')
  })

  it('falls back to a neutral glyph for a blank name', () => {
    expect(avatarFor('abc', '   ').initial).toBe('?')
  })

  it('handles a multi-byte first character without splitting it', () => {
    expect(avatarFor('abc', '🙂 hello').initial).toBe('🙂')
  })

  it('is deterministic for the same peer id', () => {
    expect(avatarFor('abc', 'bao').hue).toBe(avatarFor('abc', 'different').hue)
  })

  it('keys the hue on peer id, not name, so a rename keeps the colour', () => {
    expect(avatarFor('abc', 'x').hue).not.toBe(avatarFor('xyz', 'x').hue)
  })

  it('produces a hue inside the colour wheel', () => {
    for (const id of ['a', 'bb', 'ccc', 'dddd', 'zzzzz']) {
      const {hue} = avatarFor(id, 'n')
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })
})

describe('diffRoster', () => {
  it('reports a peer that appeared', () => {
    const {joined, left} = diffRoster([peer('a')], [peer('a'), peer('b')])
    expect(joined.map(p => p.peerId)).toEqual(['b'])
    expect(left).toHaveLength(0)
  })

  it('reports a peer that vanished', () => {
    const {joined, left} = diffRoster([peer('a'), peer('b')], [peer('a')])
    expect(left.map(p => p.peerId)).toEqual(['b'])
    expect(joined).toHaveLength(0)
  })

  it('reports nothing when the roster is unchanged', () => {
    const {joined, left} = diffRoster([peer('a')], [peer('a')])
    expect(joined).toHaveLength(0)
    expect(left).toHaveLength(0)
  })

  it('ignores a rename of the same peer', () => {
    const {joined, left} = diffRoster([peer('a', 'old')], [peer('a', 'new')])
    expect(joined).toHaveLength(0)
    expect(left).toHaveLength(0)
  })

  it('treats an empty previous roster as no joins, so the first render is silent', () => {
    const {joined} = diffRoster([], [peer('a'), peer('b')])
    expect(joined).toHaveLength(0)
  })
})
