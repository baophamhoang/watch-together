import {describe, expect, it} from 'vitest'
import {electHost, resolveHostTie} from './election'
import type {RosterEntry} from './types'

const peer = (peerId: string, joinOrder: number): RosterEntry =>
  ({peerId, name: peerId, joinOrder})

describe('electHost', () => {
  it('returns null when nobody is left', () => {
    expect(electHost([])).toBeNull()
  })

  it('picks the earliest joiner', () => {
    expect(electHost([peer('c', 3), peer('a', 1), peer('b', 2)])).toBe('a')
  })

  it('is independent of roster ordering', () => {
    const roster = [peer('c', 3), peer('a', 1), peer('b', 2)]
    expect(electHost([...roster].reverse())).toBe(electHost(roster))
  })

  it('breaks equal join orders deterministically by peer id', () => {
    expect(electHost([peer('z', 1), peer('a', 1)])).toBe('a')
  })
})

describe('resolveHostTie', () => {
  it('keeps the lower peer id as host', () => {
    expect(resolveHostTie('aaa', 'zzz')).toBe('keep')
  })

  it('demotes the higher peer id', () => {
    expect(resolveHostTie('zzz', 'aaa')).toBe('demote')
  })

  it('reaches opposite verdicts on the two sides of the same tie', () => {
    expect(resolveHostTie('aaa', 'zzz')).not.toBe(resolveHostTie('zzz', 'aaa'))
  })
})
