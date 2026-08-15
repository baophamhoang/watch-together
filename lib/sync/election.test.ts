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
  // The peer holding the room's actual content must win, whatever its id.
  // Peer id alone is a coin flip with no relationship to legitimacy, and the
  // loser wipes its own state — so the arbitrary half of the time, the real
  // queue was destroyed by the peer that had just arrived with nothing.
  it('keeps the host with more state, regardless of peer id', () => {
    expect(resolveHostTie('zzz', 'aaa', {selfVersion: 20, otherVersion: 0})).toBe('keep')
    expect(resolveHostTie('aaa', 'zzz', {selfVersion: 0, otherVersion: 20})).toBe('demote')
  })

  it('falls back to peer id when both hold the same amount of state', () => {
    expect(resolveHostTie('aaa', 'zzz', {selfVersion: 5, otherVersion: 5})).toBe('keep')
    expect(resolveHostTie('zzz', 'aaa', {selfVersion: 5, otherVersion: 5})).toBe('demote')
  })

  // Two empty peers racing in a genuinely new room is the ordinary
  // simultaneous-join case, and must still resolve deterministically.
  it('resolves an empty-room race deterministically', () => {
    expect(resolveHostTie('aaa', 'zzz', {selfVersion: 0, otherVersion: 0})).toBe('keep')
    expect(resolveHostTie('zzz', 'aaa', {selfVersion: 0, otherVersion: 0})).toBe('demote')
  })
})

describe('resolveHostTie — opposite verdicts property', () => {
  // The defining property of resolveHostTie: both peers run it on the same
  // pair of inputs (id and version swapped between self/other) and MUST land
  // on opposite verdicts. A rule that can return 'keep' on both sides
  // deadlocks the room with two hosts; one that returns 'demote' on both
  // leaves it hostless and frozen. Checked exhaustively — not spot-checked —
  // because a deadlock here is worse than the bug being fixed, and it would
  // be invisible in a happy-path run.
  const ids = ['aaa', 'mmm', 'zzz']
  const versions = [0, 1, 5, 20]

  it('gives exactly one side "keep" for every id and version combination', () => {
    let checked = 0
    for (const selfId of ids) {
      for (const otherId of ids) {
        if (selfId === otherId) continue
        for (const selfVersion of versions) {
          for (const otherVersion of versions) {
            const selfVerdict = resolveHostTie(selfId, otherId, {selfVersion, otherVersion})
            const otherVerdict = resolveHostTie(otherId, selfId, {
              selfVersion: otherVersion,
              otherVersion: selfVersion,
            })
            const label = `${selfId}(v${selfVersion}) vs ${otherId}(v${otherVersion}): got ${selfVerdict}/${otherVerdict}`
            expect(otherVerdict, label).not.toBe(selfVerdict)
            checked++
          }
        }
      }
    }
    // Sanity check that the loop actually exercised the full matrix: 3 ids
    // paired with 2 others each, times 4x4 version combinations.
    expect(checked).toBe(ids.length * (ids.length - 1) * versions.length * versions.length)
  })
})
