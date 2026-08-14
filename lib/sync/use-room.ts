'use client'

import {useEffect, useRef, useState} from 'react'
import {joinRoom, selfId} from 'trystero'
import {APP_ID, HOST_CLAIM_MS} from './constants'
import {electHost, resolveHostTie} from './election'
import {expirePending, shouldAcceptState, type PendingIntent} from './pending'
import {applyIntent, emptyRoomState} from './room-reducer'
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
  warning: string | null
}

export function useRoom(code: string, name: string): RoomApi {
  const [state, setState] = useState<RoomState>(emptyRoomState)
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [isHost, setIsHost] = useState(false)
  const [status, setStatus] = useState<RoomStatus>('connecting')
  const [beat] = useState<Beat | null>(null)
  const [offsetMs] = useState<number | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

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
    const stateAction = room.makeAction<RoomState>('state')
    const intentAction = room.makeAction<Intent>('intent')

    /** Last state issued by the host. The only basis for version comparison. */
    const confirmedRef = {current: emptyRoomState()}
    /** What the user sees: confirmed state plus any un-acknowledged local intents. */
    const displayRef = {current: emptyRoomState()}
    const pendingRef = {current: [] as PendingIntent[]}

    const showConfirmed = (next: RoomState) => {
      confirmedRef.current = next
      displayRef.current = next
      pendingRef.current = []
      setState(next)
      setWarning(null)
    }

    // Host is the only writer: apply, then broadcast the new authoritative state.
    intentAction.onMessage = intent => {
      if (!isHostRef.current) return
      const next = applyIntent(confirmedRef.current, intent, Date.now())
      if (next === confirmedRef.current) return
      showConfirmed(next)
      stateAction.send(next)
    }

    stateAction.onMessage = incoming => {
      if (isHostRef.current) return
      if (!shouldAcceptState(confirmedRef.current, incoming)) return
      showConfirmed(incoming)
    }

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
      // Beat tie-resolution (below) depends on every promotion announcing itself,
      // including the ordinary simultaneous-claim race — dropping this in favor
      // of the state broadcast would leave a double-claim undetected, since
      // stateAction.onMessage no-ops whenever the receiver already believes it
      // is host.
      announce()
      // Seeds already-connected peers (and, after a host hand-off, the room)
      // with this host's replica instead of leaving them on stale state.
      stateAction.send(confirmedRef.current)
    }

    const demote = () => {
      isHostRef.current = false
      setIsHost(false)
      // `joinOrderRef` is deliberately NOT cleared here: it records who is
      // connected, which is independent of whether we happen to be host. Clearing
      // it would leave a later promotion — when the host departs — publishing a
      // roster that omits every peer already in the room.
      // The replication refs, by contrast, MUST be reset. `shouldAcceptState`
      // compares incoming state against `confirmedRef`, so a peer that briefly
      // held the room and applied even one intent keeps a version high enough to
      // reject the winner's authoritative state — and stays permanently diverged.
      // That is precisely the failure the confirmed/display split exists to
      // prevent, arriving through the back door.
      confirmedRef.current = emptyRoomState()
      displayRef.current = emptyRoomState()
      pendingRef.current = []
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
        // Targeted so the joiner gets the queue without waiting for the next
        // change; a broadcast here would also re-send stale state to peers
        // who are already caught up.
        stateAction.send(confirmedRef.current, {target: peerId})
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

    sendRef.current = (intent: Intent) => {
      const now = Date.now()
      if (isHostRef.current) {
        const next = applyIntent(confirmedRef.current, intent, now)
        if (next === confirmedRef.current) return
        showConfirmed(next)
        stateAction.send(next)
        return
      }
      // Guests render the change immediately; the host's broadcast replaces it.
      displayRef.current = applyIntent(displayRef.current, intent, now)
      pendingRef.current = [...pendingRef.current, {intent, sentAt: now}]
      setState(displayRef.current)
      intentAction.send(intent)
    }

    // An intent the host never acknowledged means we lost the authority.
    const pendingTimer = setInterval(() => {
      if (isHostRef.current || pendingRef.current.length === 0) return
      const {kept, expired} = expirePending(pendingRef.current, Date.now())
      if (expired.length === 0) return
      pendingRef.current = kept
      displayRef.current = confirmedRef.current
      setState(confirmedRef.current)
      setWarning('Lost contact with the host — that change did not stick.')
    }, 500)

    return () => {
      clearTimeout(claimTimer)
      clearInterval(pendingTimer)
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
    warning,
  }
}
