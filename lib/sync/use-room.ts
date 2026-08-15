'use client'

import {type RefObject, useEffect, useRef, useState} from 'react'
import {joinRoom, selfId} from 'trystero'

/**
 * Room teardowns waiting to happen, keyed by room code.
 *
 * Trystero caches a room by id, and `leave()` does three things that make an
 * immediate teardown hostile to a remount: it evicts the room from that cache,
 * it fires its relay unsubscribes **asynchronously**, and — when no rooms
 * remain — it destroys the shared connection pool outright. A remount that
 * lands before those settle therefore builds a brand-new room on top of a relay
 * that is still being dismantled, and the in-flight unsubscribes then cancel
 * the *new* subscriptions. The tab ends up subscribed to nothing: connected in
 * name, discovering no peers, reporting "1 watching" forever.
 *
 * React Strict Mode performs exactly that mount → unmount → mount in
 * development, which is why this app has never worked under `next dev`. But a
 * fast refresh, a route change or a re-key does the same thing in production,
 * so deferring the leave is a real fix that development merely surfaced first —
 * not a workaround for a development-only quirk.
 *
 * Module scope, not a ref: the point is to survive the unmount that schedules
 * it. A macrotask is enough, because React runs the remount's effect in the
 * same flush as the cleanup.
 */
const pendingLeaves = new Map<string, ReturnType<typeof setTimeout>>()
import {appendMessage, isChatMessage} from '@/lib/chat/messages'
import type {ChatKind, ChatMessage} from '@/lib/chat/types'
import {DEFAULT_NICKNAME, MAX_NICKNAME_LENGTH} from '@/lib/identity'
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
  messages: ChatMessage[]
  sendChat(kind: ChatKind, body: string): void
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
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const isHostRef = useRef(false)
  const joinOrderRef = useRef(new Map<string, number>())
  const nextJoinOrderRef = useRef(1)
  const sendRef = useRef<(intent: Intent) => void>(() => {})
  const sendChatRef = useRef<(kind: ChatKind, body: string) => void>(() => {})
  const announceNameRef = useRef<(name: string) => void>(() => {})

  // The join effect below runs only when `code` changes, so every `name` its
  // long-lived closures read would otherwise be the value at mount — which is
  // the DEFAULT, because Room hydrates the real nickname from localStorage in a
  // mount effect that lands in the same passive-effect flush. Mirroring it into
  // a ref (the `isHostRef` pattern) keeps those closures current without
  // putting `name` in the dep array, which would tear down and rebuild the whole
  // WebRTC room on every keystroke of a rename.
  const nameStateRef = useRef(name)
  useEffect(() => {
    nameStateRef.current = name
  })

  useEffect(() => {
    // A teardown still queued for this code means we are the remount it was
    // about to strand. Cancelling it leaves the room in Trystero's cache, so
    // the `joinRoom` below hands back the live room instead of building a
    // second one on top of a relay that is being dismantled. See
    // `pendingLeaves` for why the leave is deferred at all.
    const queuedLeave = pendingLeaves.get(code)
    if (queuedLeave !== undefined) {
      clearTimeout(queuedLeave)
      pendingLeaves.delete(code)
    }

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
    const chatAction = room.makeAction<ChatMessage>('chat')
    // The spec's `hello` action, narrowed to the one thing it was ever needed
    // for here: a peer's claimed nickname. Nothing else in `hello`'s payload has
    // an owner other than the host, and the host already seeds state and roster
    // directly in `onPeerJoin`. Without this, `nameRef` below could only ever
    // hold the placeholder, so every avatar, toast and chat line in the room
    // read "friend" no matter what anyone typed on the landing page.
    const nameAction = room.makeAction<string>('name')

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

    chatAction.onMessage = incoming => {
      // Deliberately not gated on hostIdRef: chat needs no ordering guarantee and
      // should keep working through a host hand-off. The peer's own claimed name
      // is used as-is — this is a room you shared a code with, not a public space.
      //
      // Validated first, though. `ChatMessage` is a compile-time claim about a
      // payload another browser wrote, and the renderer trusts it: a message
      // whose `name` is not a string throws inside avatarFor DURING RENDER,
      // which unmounts the whole tree — player, queue and connection with it —
      // and then re-throws on every render after, because the payload is now in
      // state. Dropping it here is the only place that costs nothing.
      if (!isChatMessage(incoming)) return
      setMessages(current => appendMessage(current, incoming))
    }

    const nameRef = new Map<string, string>()

    // React state is stale inside these long-lived closures, so anything a
    // callback reads must live in a ref.
    const rosterRef = {current: [] as RosterEntry[]}
    const sawHostRef = {current: false}

    const publishRoster = () => {
      const entries: RosterEntry[] = [
        {peerId: selfId, name: nameStateRef.current, joinOrder: 0},
        ...[...joinOrderRef.current.entries()].map(([peerId, joinOrder]) => ({
          peerId,
          name: nameRef.get(peerId) ?? DEFAULT_NICKNAME,
          joinOrder,
        })),
      ]
      rosterRef.current = entries
      setRoster(entries)
      fire(rosterAction.send(entries))
    }

    nameAction.onMessage = (incoming, {peerId}) => {
      // Same trust boundary as chat: the `string` type parameter is a claim, not
      // a guarantee. Clamp it to the shape a local nickname already takes, and
      // fall back rather than coercing — String({}) would put the literal text
      // "[object Object]" on an avatar.
      const claimed =
        typeof incoming === 'string' ? incoming.trim().slice(0, MAX_NICKNAME_LENGTH) : ''
      nameRef.set(peerId, claimed || DEFAULT_NICKNAME)
      // Only the host publishes the roster, so only the host has anything to do
      // here — every guest learns the new name from the roster that follows.
      if (isHostRef.current) publishRoster()
    }

    announceNameRef.current = (next: string) => {
      fire(nameAction.send(next))
      // Our own roster entry comes from `nameStateRef`, not from `nameRef`, so a
      // rename by the host has to republish to be seen by anyone, including us.
      if (isHostRef.current) publishRoster()
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
      // A placeholder only until their `name` message lands. Guarded rather than
      // assigned, so a name that somehow arrived first is not overwritten with
      // the default by an `onPeerJoin` that fired late.
      if (!nameRef.has(peerId)) nameRef.set(peerId, DEFAULT_NICKNAME)
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
      // Sent by every peer, host or not, and AFTER the host block above so the
      // beat-before-roster/state ordering that block documents is untouched.
      // Targeted, because everyone already here knows our name. The host will
      // fold the reply into the roster it publishes next.
      fire(nameAction.send(nameStateRef.current, {target: peerId}))
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

    sendChatRef.current = (kind, body) => {
      const trimmed = body.trim()
      if (!trimmed) return
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        peerId: selfId,
        name: nameStateRef.current,
        kind,
        body: trimmed,
        at: Date.now(),
      }
      setMessages(current => appendMessage(current, message))
      fire(chatAction.send(message))
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
      // Deferred by a macrotask rather than run here, so a remount landing in
      // the same flush can cancel it. The timers above are NOT deferred: they
      // belong to this effect run and the remount creates its own.
      pendingLeaves.set(
        code,
        setTimeout(() => {
          pendingLeaves.delete(code)
          room.leave()
        }, 0),
      )
    }
    // Reconnect only when the room identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  // Broadcasts the nickname, separately from the join effect so a rename costs a
  // single message rather than a full reconnect. The first run fires with the
  // default and reaches nobody — no peer is connected yet — which is why
  // `onPeerJoin` also sends it targeted; between them, both the peer who arrives
  // first and the peer who arrives second learn the other's name.
  useEffect(() => {
    announceNameRef.current(name)
  }, [name])

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
    messages,
    sendChat: (kind, body) => sendChatRef.current(kind, body),
  }
}
