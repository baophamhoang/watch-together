'use client'

import {useEffect, useRef, useState} from 'react'
import {joinRoom, selfId} from 'trystero'
import {APP_ID, HOST_CLAIM_MS} from './constants'
import {electHost, resolveHostTie} from './election'
import {emptyRoomState} from './room-reducer'
import type {Beat, Intent, RoomState, RosterEntry} from './types'

export type RoomStatus = 'connecting' | 'connected' | 'blocked'

export type RoomApi = {
  state: RoomState
  roster: RosterEntry[]
  selfId: string
  isHost: boolean
  status: RoomStatus
  beat: Beat | null
  offsetMs: number | null
  send(intent: Intent): void
}

export function useRoom(code: string, name: string): RoomApi {
  const [state, setState] = useState<RoomState>(emptyRoomState)
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [isHost, setIsHost] = useState(false)
  const [status, setStatus] = useState<RoomStatus>('connecting')
  const [beat] = useState<Beat | null>(null)
  const [offsetMs] = useState<number | null>(null)

  const isHostRef = useRef(false)
  const joinOrderRef = useRef(new Map<string, number>())
  const nextJoinOrderRef = useRef(1)
  const sendRef = useRef<(intent: Intent) => void>(() => {})

  useEffect(() => {
    const room = joinRoom({appId: APP_ID}, code, {
      onJoinError: () => setStatus('blocked'),
    })

    // Trystero 0.25 actions are objects: `.send(data, opts)` and an assignable
    // `.onMessage`. The older `const [send, get] = makeAction()` tuple is gone.
    const beatAction = room.makeAction<Beat>('beat')
    const rosterAction = room.makeAction<RosterEntry[]>('roster')

    const nameRef = new Map<string, string>()

    // React state is stale inside these long-lived closures, so anything a
    // callback reads must live in a ref.
    const rosterRef = {current: [] as RosterEntry[]}
    const sawHostRef = {current: false}

    const publishRoster = () => {
      const entries: RosterEntry[] = [
        {peerId: selfId, name, joinOrder: 0},
        ...[...joinOrderRef.current.entries()].map(([peerId, joinOrder]) => ({
          peerId,
          name: nameRef.get(peerId) ?? 'friend',
          joinOrder,
        })),
      ]
      rosterRef.current = entries
      setRoster(entries)
      rosterAction.send(entries)
    }

    /**
     * A presence beat. Task 12 replaces the placeholder fields with a real
     * snapshot, but the host must announce itself from the very first task or
     * nobody can tell who the authority is.
     */
    const announce = () => {
      beatAction.send({
        version: 0,
        currentTrackId: null,
        isPlaying: false,
        position: 0,
        hostClock: Date.now(),
      })
    }

    const promote = () => {
      isHostRef.current = true
      setIsHost(true)
      setStatus('connected')
      publishRoster()
      announce()
    }

    const demote = () => {
      isHostRef.current = false
      setIsHost(false)
      // `joinOrderRef` is deliberately NOT cleared here: it records who is
      // connected, which is independent of whether we happen to be host. Clearing
      // it would leave a later promotion — when the host departs — publishing a
      // roster that omits every peer already in the room.
      setState(emptyRoomState())
    }

    // Claim the room only if no existing host announced itself first.
    const claimTimer = setTimeout(() => {
      if (!isHostRef.current && !sawHostRef.current) promote()
    }, HOST_CLAIM_MS)

    beatAction.onMessage = (_incoming, {peerId}) => {
      setStatus('connected')
      if (!isHostRef.current) {
        sawHostRef.current = true
        return
      }
      // Two peers claimed the room at once; both sides resolve it identically.
      if (resolveHostTie(selfId, peerId) === 'demote') demote()
    }

    rosterAction.onMessage = entries => {
      if (isHostRef.current) return
      rosterRef.current = entries
      setRoster(entries)
    }

    room.onPeerJoin = peerId => {
      nameRef.set(peerId, 'friend')
      // Recorded for EVERY peer, not only while we are host. `onPeerJoin` fires
      // once per peer and never again, so when two tabs connect before either has
      // claimed the room — the ordinary case when a link is shared — a host-gated
      // version misses the other peer permanently. Both would then publish a
      // roster containing only themselves, and a later successor election would
      // find no survivors and leave the room hostless and frozen.
      joinOrderRef.current.set(peerId, nextJoinOrderRef.current++)
      if (isHostRef.current) {
        publishRoster()
        // Re-announce so the newcomer learns who the host is without waiting for
        // the next beat. This broadcasts; it is not a targeted send.
        announce()
      }
      setStatus('connected')
    }

    room.onPeerLeave = peerId => {
      joinOrderRef.current.delete(peerId)
      nameRef.delete(peerId)
      if (isHostRef.current) {
        publishRoster()
        return
      }
      // Host vanished: phase 3 migrates properly, phase 1 just promotes the
      // deterministic successor so the room does not silently freeze.
      sawHostRef.current = false
      const survivors = rosterRef.current.filter(entry => entry.peerId !== peerId)
      if (electHost(survivors) === selfId) promote()
    }

    sendRef.current = () => {}

    return () => {
      clearTimeout(claimTimer)
      room.leave()
    }
    // Reconnect only when the room identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  return {
    state,
    roster,
    selfId,
    isHost,
    status,
    beat,
    offsetMs,
    send: intent => sendRef.current(intent),
  }
}
