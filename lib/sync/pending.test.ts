import {describe, expect, it} from 'vitest'
import {expirePending, shouldAcceptState, type PendingIntent} from './pending'
import {emptyRoomState} from './room-reducer'

describe('shouldAcceptState', () => {
  const current = {...emptyRoomState(), version: 5}

  it('accepts a newer version', () => {
    expect(shouldAcceptState(current, {...current, version: 6})).toBe(true)
  })

  it('rejects a stale version arriving out of order', () => {
    expect(shouldAcceptState(current, {...current, version: 4})).toBe(false)
  })

  it('rejects a duplicate of the current version', () => {
    expect(shouldAcceptState(current, {...current, version: 5})).toBe(false)
  })
})

describe('expirePending', () => {
  const pending: PendingIntent[] = [
    {intent: {type: 'play'}, sentAt: 1000},
    {intent: {type: 'skip'}, sentAt: 4000},
  ]

  it('keeps intents still inside the window', () => {
    const {kept, expired} = expirePending(pending, 4500, 2000)
    expect(kept).toHaveLength(1)
    expect(expired).toHaveLength(1)
    expect(expired[0].intent.type).toBe('play')
  })

  it('keeps everything when nothing has timed out', () => {
    // Brief literal was 4100, but sentAt 1000 is already 2000ms+ old by then
    // (the two pending items are 3000ms apart, wider than the 2000ms timeout),
    // making zero-expired unsatisfiable for any now >= 3000. 2500 keeps both.
    expect(expirePending(pending, 2500, 2000).expired).toHaveLength(0)
  })

  it('handles an empty list', () => {
    expect(expirePending([], 9999, 2000)).toEqual({kept: [], expired: []})
  })
})
