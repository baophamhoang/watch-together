'use client'

import {type RefObject, useEffect, useRef, useState} from 'react'
import {joinRoom, selfId} from 'trystero'
import {bestOffset, makeSample, pushSample, type ClockSample} from './clock'
import {APP_ID, BEAT_INTERVAL_MS, CLOCK_BURST_SAMPLES, CLOCK_RESAMPLE_MS, HOST_CLAIM_MS} from './constants'
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

export function useRoom(
  code: string,
  name: string,
  positionRef: RefObject<() => number>,
): RoomApi {
  const [state, setState] = useState<RoomState>(emptyRoomState)
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [isHost, setIsHost] = useState(false)
  const [status, setStatus] = useState<RoomStatus>('connecting')
  const [beat, setBeat] = useState<Beat | null>(null)
  const [offsetMs, setOffsetMs] = useState<number | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const isHostRef = useRef(false)
  const joinOrderRef = useRef(new Map<string, number>())
  const nextJoinOrderRef = useRef(1)
  const sendRef = useRef<(intent: Intent) => void>(() => {})

  useEffect(() => {
    const room = joinRoom({appId: APP_ID}, code, {
      onJoinError: () => setStatus('blocked'),
    })

    /** Trystero's send rejects when a channel closes mid-flight, which is routine
     *  when a peer drops. Nothing downstream can act on it, so swallow it rather
     *  than leaving an uncaught rejection in the console. */
    const fire = (p: Promise<unknown>) => void p.catch(() => {})

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
      fire(stateAction.send(next))
    }

    stateAction.onMessage = (incoming, {peerId}) => {
      if (isHostRef.current) return
      // Only the host's own state is authoritative — anyone else's is either
      // stale or forged. This check is safe only because every place that
      // establishes us as host to a peer — `promote()` and the host branch of
      // `room.onPeerJoin`, both below — calls `announce()` BEFORE
      // `publishRoster()`/`stateAction.send()`. `hostIdRef` is set only by
      // `beatAction.onMessage`, and beat/roster/state all travel the same
      // ordered data channel per peer, so sending the beat first guarantees
      // `hostIdRef` already names us by the time roster/state arrive here.
      // Do not reorder announce() after the other two sends in either place.
      if (peerId !== hostIdRef.current) return
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
      fire(rosterAction.send(entries))
    }

    const hostIdRef = {current: null as string | null}
    const samplesRef = {current: [] as ClockSample[]}

    const announce = () => {
      const snapshot = confirmedRef.current
      fire(beatAction.send({
        version: snapshot.version,
        currentTrackId: snapshot.currentTrackId,
        isPlaying: snapshot.isPlaying,
        position: positionRef.current(),
        hostClock: Date.now(),
      }))
    }

    const beatTimer = setInterval(() => {
      if (isHostRef.current) announce()
    }, BEAT_INTERVAL_MS)

    const clockAction = room.makeAction('clock', {
      kind: 'request',
      onRequest: () => Date.now(),
    })

    const sampleClock = async () => {
      const hostId = hostIdRef.current
      if (!hostId || isHostRef.current) return
      try {
        const t0 = Date.now()
        const hostClock = await clockAction.request(null, {target: hostId, timeoutMs: 3000})
        const t2 = Date.now()
        samplesRef.current = pushSample(samplesRef.current, makeSample(t0, Number(hostClock), t2))
        setOffsetMs(bestOffset(samplesRef.current))
      } catch {
        // A dropped sample is harmless; the next one will land.
      }
    }

    const clockTimer = setInterval(sampleClock, CLOCK_RESAMPLE_MS)

    const promote = () => {
      isHostRef.current = true
      setIsHost(true)
      setStatus('connected')
      // Sent first — see the comment on stateAction.onMessage: receivers only
      // accept roster/state once a beat has told them who the host is, so the
      // beat must go out before publishRoster()/stateAction.send(), not after.
      // This also covers beat tie-resolution, which depends on every
      // promotion announcing itself, including the ordinary simultaneous-claim
      // race — dropping this call would leave a double-claim undetected, since
      // stateAction.onMessage no-ops whenever the receiver already believes it
      // is host.
      announce()
      publishRoster()
      // Seeds already-connected peers (and, after a host hand-off, the room)
      // with this host's replica instead of leaving them on stale state.
      fire(stateAction.send(confirmedRef.current))
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
      setWarning(null)
    }

    // Claim the room only if no existing host announced itself first.
    const claimTimer = setTimeout(() => {
      if (!isHostRef.current && !sawHostRef.current) promote()
    }, HOST_CLAIM_MS)

    beatAction.onMessage = (incoming, {peerId}) => {
      setStatus('connected')
      // Recorded for EVERY beat, before the host branch below returns. A peer that
      // loses a host tie demotes itself here, and if it had not already recorded
      // who the winner is, the peer gate on state and roster would drop the new
      // host's broadcasts until its next heartbeat.
      const previousHost = hostIdRef.current
      hostIdRef.current = peerId
      if (isHostRef.current) {
        // Two peers claimed the room at once; both sides resolve it identically.
        if (resolveHostTie(selfId, peerId) === 'demote') demote()
        return
      }
      // A beat proves a host already exists, so the claim timer must not
      // self-promote. Losing this line makes every guest joining an established
      // room claim it after HOST_CLAIM_MS, broadcast a roster nobody should
      // trust, and only then get demoted on hearing the real host.
      sawHostRef.current = true
      const isNewHost = previousHost !== peerId
      setBeat(incoming)
      if (isNewHost) {
        samplesRef.current = []
        for (let i = 0; i < CLOCK_BURST_SAMPLES; i++) void sampleClock()
      }
    }

    rosterAction.onMessage = (entries, {peerId}) => {
      if (isHostRef.current) return
      // See the comment on stateAction.onMessage: same host-only gate, same
      // announce-before-roster ordering requirement.
      if (peerId !== hostIdRef.current) return
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
        // Re-announced first so the newcomer learns who the host is without
        // waiting for the next beat. This broadcasts; it is not a targeted
        // send. Sending it before the other two matters, not just as a nice-
        // to-have: see the comment on stateAction.onMessage. Sending it last
        // (as this used to) meant a brand new peer's very first roster and
        // state — the two messages that actually seed their view of the
        // room — arrived before any beat had set their hostIdRef, so the
        // host-only gate on those handlers silently dropped both.
        announce()
        publishRoster()
        // Targeted so the joiner gets the queue without waiting for the next
        // change; a broadcast here would also re-send stale state to peers
        // who are already caught up.
        fire(stateAction.send(confirmedRef.current, {target: peerId}))
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
        fire(stateAction.send(next))
        return
      }
      // Guests render the change immediately; the host's broadcast replaces it.
      // Mirror the host's no-op check above: an intent that would not change
      // our own displayed state (e.g. play/pause/skip while nothing is
      // current, or a duplicate remove) must not queue a pending entry — the
      // host has nothing to acknowledge, so that entry could only ever age
      // out and raise a false "lost contact" warning. This does not catch
      // every case: an intent that is a no-op against the host's state but
      // not ours still slips through, which needs per-peer sequence numbers
      // we are deliberately not building here.
      const next = applyIntent(displayRef.current, intent, now)
      if (next === displayRef.current) return
      displayRef.current = next
      pendingRef.current = [...pendingRef.current, {intent, sentAt: now}]
      setState(displayRef.current)
      fire(intentAction.send(intent))
    }

    // An intent the host never acknowledged means we lost the authority.
    const pendingTimer = setInterval(() => {
      if (isHostRef.current || pendingRef.current.length === 0) return
      const {kept, expired} = expirePending(pendingRef.current, Date.now())
      if (expired.length === 0) return
      pendingRef.current = kept
      // Rebuild the display from confirmed state plus the intents still in
      // flight, rather than hard-resetting to confirmed alone. Keeping an entry
      // in `pendingRef` while erasing its visual effect is self-contradictory:
      // the user would watch a change made half a second ago vanish even though
      // we still expect it to land.
      displayRef.current = kept.reduce(
        (state, item) => applyIntent(state, item.intent, item.sentAt),
        confirmedRef.current,
      )
      setState(displayRef.current)
      setWarning('Lost contact with the host — that change did not stick.')
    }, 500)

    return () => {
      clearTimeout(claimTimer)
      clearInterval(pendingTimer)
      clearInterval(beatTimer)
      clearInterval(clockTimer)
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
