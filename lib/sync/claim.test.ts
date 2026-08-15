import {describe, expect, it} from 'vitest'
import {BEAT_INTERVAL_MS, HOST_CLAIM_MS, HOST_CLAIM_WITH_PEERS_MS} from './constants'
import {shouldClaimRoom} from './claim'

describe('claim timing invariants', () => {
  // The defect this phase exists to fix: a joiner gave up waiting after 1500ms
  // while the host only announced every 2000ms, so it reliably claimed a room
  // that already had one. Every comparable system sizes this at 2-3x its
  // heartbeat; we were at 0.75x.
  it('waits longer than a full heartbeat before claiming a room with peers in it', () => {
    expect(HOST_CLAIM_WITH_PEERS_MS).toBeGreaterThan(BEAT_INTERVAL_MS * 2)
  })

  it('claims an apparently empty room without waiting for a heartbeat', () => {
    expect(HOST_CLAIM_MS).toBeLessThan(HOST_CLAIM_WITH_PEERS_MS)
  })
})

describe('shouldClaimRoom', () => {
  const base = {isHost: false, sawHost: false, connectedPeers: 0}

  it('claims when alone and nobody has announced', () => {
    expect(shouldClaimRoom(base)).toBe(true)
  })

  it('never claims once a host has announced', () => {
    expect(shouldClaimRoom({...base, sawHost: true})).toBe(false)
  })

  it('never claims when already host', () => {
    expect(shouldClaimRoom({...base, isHost: true})).toBe(false)
  })

  // The rejoin case. Peers are present but none has announced yet — they may
  // still be completing Trystero's handshake, which the library itself allows
  // ten seconds for. Claiming here is what destroyed the room.
  it('does not claim while connected peers have not yet announced', () => {
    expect(shouldClaimRoom({...base, connectedPeers: 1})).toBe(false)
  })

  it('claims once the longer window has elapsed even with peers present', () => {
    expect(shouldClaimRoom({...base, connectedPeers: 1, waitedFullWindow: true})).toBe(true)
  })
})
