'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import {SkipForward, Volume2, VolumeX} from 'lucide-react'
import {AddTrackForm} from './AddTrackForm'
import {ChatComposer} from './ChatComposer'
import {ChatPanel} from './ChatPanel'
import {GifPicker} from './GifPicker'
import {InviteBar} from './InviteBar'
import {NameBadge} from './NameBadge'
import {Queue} from './Queue'
import {RoomTabs} from './RoomTabs'
import {TapToWatch} from './TapToWatch'
import {Toasts, type Toast} from './Toasts'
import {hasStoredNickname, loadNickname, saveNickname} from '@/lib/identity'
import {diffRoster} from '@/lib/presence'
import {loadSoundMuted, playNotification, saveSoundMuted} from '@/lib/sound/notify'
import type {RosterEntry, Track, Unplayable} from '@/lib/sync/types'
import {useRoom} from '@/lib/sync/use-room'
import {useSyncPlayback} from '@/lib/sync/use-sync-playback'
import {useYouTubePlayer} from '@/lib/youtube/use-player'

export function Room({code, gifsEnabled}: {code: string; gifsEnabled: boolean}) {
  const [name, setName] = useState('friend')
  const [needsName, setNeedsName] = useState(false)
  const positionRef = useRef<() => number>(() => 0)

  useEffect(() => {
    // Reading localStorage must wait until after mount (it doesn't exist on
    // the server), so hydrating the nickname here is unavoidable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(loadNickname(window.localStorage))
    // Someone who arrived by invite link has never seen the landing page, so
    // nothing is stored and they would be "friend" to everyone with no way to
    // change it. Opening the badge in edit mode is the whole fix for that.
    setNeedsName(!hasStoredNickname(window.localStorage))
  }, [])

  const room = useRoom(code, name, positionRef)

  // Declared here, above the ref block below, so the ref-mirror effect can
  // read it without a forward reference to a `const` declared later in the
  // component.
  const [activated, setActivated] = useState(false)

  // Refs keep the player's event callbacks stable, so the player is never
  // rebuilt just because room state changed. `room` is a fresh object every
  // render (see useRoom), so these can't be synced via a dependency array —
  // refreshed every render instead, same as `roomRef` in useSyncPlayback.
  const sendRef = useRef(room.send)
  const trackIdRef = useRef<string | null>(null)
  const isHostRef = useRef(room.isHost)
  const activatedRef = useRef(false)
  useEffect(() => {
    sendRef.current = room.send
    trackIdRef.current = room.state.currentTrackId
    isHostRef.current = room.isHost
    activatedRef.current = activated
  })

  const [localBlock, setLocalBlock] = useState<Unplayable | null>(null)

  const onEnded = useCallback(() => {
    const trackId = trackIdRef.current
    if (trackId) sendRef.current({type: 'ended', trackId})
  }, [])

  // Embed and region restrictions differ per viewer, so only the host's verdict
  // skips the track for everyone. A guest who cannot play it says so locally.
  const onUnplayable = useCallback((reason: Unplayable) => {
    const trackId = trackIdRef.current
    if (!trackId) return
    if (isHostRef.current) sendRef.current({type: 'unplayable', trackId, reason})
    else setLocalBlock(reason)
  }, [])

  const onUserPlay = useCallback(() => {
    // Before the gate is tapped this user has expressed no intent, so any
    // state change is the player loading or the sync layer acting. Reporting
    // it would let one person's arrival start or stop the video for the room.
    if (!activatedRef.current) return
    sendRef.current({type: 'play'})
  }, [])

  const onUserPause = useCallback((position: number) => {
    if (!activatedRef.current) return
    sendRef.current({type: 'pause', position})
  }, [])

  useEffect(() => {
    // A track change is a fresh chance to play, so a stale block message from
    // the previous track must not carry over.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalBlock(null)
  }, [room.state.currentTrackId])

  const {containerRef, handle, loadError} = useYouTubePlayer({
    onEnded,
    onUnplayable,
    onUserPlay,
    onUserPause,
  })

  useEffect(() => {
    positionRef.current = () => handle?.getCurrentTime() ?? 0
  }, [handle])

  const {resyncing, current} = useSyncPlayback(room, handle)

  // Debug instrumentation. The YouTube iframe is cross-origin, so this is the
  // only way an automated check can read what each peer is actually playing.
  // Gated on NEXT_PUBLIC_WT_DEBUG, deliberately NOT `NODE_ENV === 'production'`:
  // `next build` inlines NODE_ENV into the client bundle at build time, so
  // `next start` — the only way this whole phase is verified, since dev's
  // Strict Mode double-invokes effects and races the host election — is
  // indistinguishable from production by that check. A NODE_ENV guard would
  // strip this from the exact build it needs to work in. playwright.config.ts
  // sets NEXT_PUBLIC_WT_DEBUG=1 for its webServer (build and start both) so
  // the e2e suite keeps working; it is unset for a real production build.
  //
  // The dependency array below is honest about what the body reads but claims
  // no precision: `room` is a fresh object on every render (see useRoom), so
  // this effect runs every render regardless of what else is listed. That is
  // intentional and cheap — it only reassigns one property on window — and the
  // hook must not be "optimized" into depending on the pieces instead, since
  // the whole point is that the reader sees current values.
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_WT_DEBUG !== '1') return
    ;(window as unknown as {__watchTogether?: unknown}).__watchTogether = {
      readAt: () => ({
        at: Date.now(),
        position: handle?.getCurrentTime() ?? null,
        trackId: room.state.currentTrackId,
        title: current?.title ?? null,
        isPlaying: room.state.isPlaying,
        isHost: room.isHost,
        peers: room.roster.length,
        offsetMs: room.offsetMs,
      }),
    }
  }, [handle, room, current])

  const [toasts, setToasts] = useState<Toast[]>([])
  const previousRoster = useRef<RosterEntry[]>([])

  useEffect(() => {
    const {joined, left} = diffRoster(previousRoster.current, room.roster)
    previousRoster.current = room.roster
    if (joined.length === 0 && left.length === 0) return
    const next = [
      ...joined.map(p => ({id: `j-${p.peerId}-${Date.now()}`, message: `${p.name} joined`})),
      ...left.map(p => ({id: `l-${p.peerId}-${Date.now()}`, message: `${p.name} left`})),
    ]
    setToasts(current => [...current, ...next])
  }, [room.roster])

  const dismissToast = useCallback(
    (id: string) => setToasts(current => current.filter(t => t.id !== id)),
    [],
  )

  const [unread, setUnread] = useState(0)
  const seenId = useRef<string | null>(null)
  const chatOpen = useRef(false)

  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(false)

  useEffect(() => {
    // Same constraint as the nickname: localStorage does not exist on the
    // server, so the stored preference can only be read after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMuted(loadSoundMuted(window.localStorage))
  }, [])

  useEffect(() => {
    mutedRef.current = muted
  })

  // Keyed on the newest message's IDENTITY, not on `messages.length`. The
  // history is capped at CHAT_HISTORY_LIMIT, so past 200 messages the length
  // pins forever — and a dependency that stops changing is an effect that stops
  // running. The badge would stop counting at exactly the moment the room is
  // busiest. Counting from the last-seen id rather than a stored count survives
  // the same cap: `seenIndex` is -1 both on the first run and once the last-seen
  // message has itself been evicted, and `length - 1 - (-1)` is the whole
  // visible history, which is the right answer in both cases.
  const messages = room.messages
  const lastMessageId = messages.at(-1)?.id

  useEffect(() => {
    if (!lastMessageId || lastMessageId === seenId.current) return
    const seenIndex = messages.findIndex(m => m.id === seenId.current)
    const added = messages.length - 1 - seenIndex
    const newest = messages.at(-1)
    seenId.current = lastMessageId
    if (!chatOpen.current) setUnread(u => u + added)
    // Only for other people's messages. A blip on your own send is not a
    // notification, it is your own keystroke echoed back at you.
    if (!mutedRef.current && newest && newest.peerId !== room.selfId) playNotification()
  }, [lastMessageId, messages, room.selfId])

  const add = (track: Track) => room.send({type: 'enqueue', track})

  return (
    <main className="flex h-dvh flex-col landscape:flex-row lg:flex-row">
      {/* The video is the protagonist: it takes every pixel the rail does not. */}
      <section className="flex min-w-0 flex-col landscape:flex-1 lg:flex-1">
        <div className="yt-player-shell relative aspect-video w-full shrink-0 bg-black landscape:aspect-auto landscape:flex-1 lg:aspect-auto lg:flex-1">
          <div ref={containerRef} className="h-full w-full" />

          {loadError && (
            <PlayerOverlay>
              Could not load the YouTube player. An ad or privacy blocker may be
              stopping it. Reload the page to try again.
            </PlayerOverlay>
          )}

          {localBlock && (
            <PlayerOverlay
              action={{
                label: 'Skip for everyone',
                onClick: () => {
                  const trackId = trackIdRef.current
                  if (trackId) room.send({type: 'unplayable', trackId, reason: localBlock})
                },
              }}
            >
              {localBlock === 'embed-blocked'
                ? "This video can't be played here — it may be blocked in your region."
                : 'This video is unavailable for you.'}
            </PlayerOverlay>
          )}

          {!current && !loadError && (
            <PlayerOverlay>
              Nothing queued yet. Paste a YouTube link in the Queue tab and it
              will start here for everyone at once.
            </PlayerOverlay>
          )}

          {/* Suppressed alongside the other overlays rather than stacked on top
              of them: this renders last, so an un-suppressed gate would sit above
              the unplayable overlay and swallow its "Skip for everyone" button. */}
          {current && !activated && !loadError && !localBlock && (
            <TapToWatch
              // This closure must NOT be memoized. `handle` comes from a
              // useMemo keyed on the player's readiness, so the `if (!handle)`
              // guard below is correct only because an inline closure is
              // rebuilt when readiness flips. A useCallback here would capture
              // the null handle forever and turn "strands the user" into "gate
              // permanently stuck" — the same bug wearing the fix's clothes.
              onActivate={() => {
                // A tap before the IFrame API has finished loading must not dismiss
                // the gate. `handle` is null across a real network round trip, and
                // the gate is the largest thing on screen from first paint, so an
                // early tap is likely on exactly the slow mobile connections this
                // feature exists for. Dismissing on that tap would strand the user:
                // the gate never returns (`activated` is one-way), and the play()
                // that useSyncPlayback issues once the handle appears comes from an
                // effect, carries no user activation, and is blocked by the very
                // policy this gate exists to satisfy — leaving a dead player with
                // no affordance and nothing on screen suggesting a reload.
                if (!handle) return
                setActivated(true)
                // Called inside the click handler so it runs under a real user
                // gesture — that activation is exactly what the autoplay policy
                // requires, and it does not survive an async hop.
                handle.play()
                // Play-then-pause, not a conditional play: the play() above is
                // what spends the gesture and unlocks autoplay, so it has to
                // happen even when the room is paused. Without the pause, a
                // guest joining a paused room starts playing alone and never
                // recovers — useSyncPlayback's effect re-runs only on
                // [handle, current?.id, state.isPlaying], none of which change,
                // and decideCorrection has no pause rung, so they settle into a
                // seek-back/play-forward cycle with audio. pause() also re-arms
                // use-player's suppression window, so a PLAYING event that
                // lands late on a slow connection cannot fire onUserPlay and
                // un-pause the video for everyone. Both calls stay synchronous:
                // an await or a timer here would leave the gesture behind.
                //
                // Known gap, deliberately left: this pause() is covered only by
                // use-player's 700ms suppression timer, not the loadSettling-style
                // swallow Task 1 gave load(). A PAUSED that lands after 700ms would
                // broadcast a spurious pause intent. Left alone because the blast
                // radius is small — it cannot un-pause anyone, and it only
                // overwrites state.position, the load anchor, costing a later
                // joiner a slightly-off load position that the next correction
                // fixes. A correct fix means suppressing a PAIR of events, not one,
                // and that complexity isn't worth it against a cost this small.
                if (!room.state.isPlaying) handle.pause()
              }}
            />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-[var(--space-3)] border-t border-border px-[var(--space-3)] py-[var(--space-2)]">
          <button
            onClick={() => room.send({type: 'skip'})}
            disabled={room.state.queue.length === 0}
            data-testid="skip"
            aria-label="Skip to next track"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-text hover:bg-surface-raised disabled:text-subtle disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
          >
            <SkipForward size={18} aria-hidden />
          </button>
          <p className="min-w-0 flex-1 truncate text-sm text-text" data-testid="now-playing">
            {current ? current.title : 'Nothing playing'}
          </p>
          {resyncing && <span className="shrink-0 text-xs text-warn">resyncing…</span>}
        </div>
      </section>

      <aside className="flex min-h-0 w-full flex-1 flex-col border-border landscape:w-[380px] landscape:flex-none landscape:border-l lg:w-[380px] lg:flex-none lg:border-l">
        <InviteBar
          code={code}
          roster={room.roster}
          selfId={room.selfId}
          status={room.status}
          isHost={room.isHost}
        />

        {room.warning && (
          <p className="shrink-0 border-b border-border px-[var(--space-3)] py-[var(--space-2)] text-sm text-warn">
            {room.warning}
          </p>
        )}

        <div className="flex shrink-0 items-center justify-between gap-[var(--space-2)] border-b border-border px-[var(--space-3)] py-[var(--space-1)]">
          <span className="text-xs text-subtle">You</span>
          <NameBadge
            name={name}
            startEditing={needsName}
            onRename={next => {
              setName(next)
              saveNickname(window.localStorage, next)
            }}
          />
        </div>

        <RoomTabs
          unreadCount={unread}
          onTabChange={next => {
            chatOpen.current = next === 'chat'
            if (next === 'chat') setUnread(0)
          }}
          queue={
            <div className="flex flex-col gap-[var(--space-3)] p-[var(--space-3)]">
              <AddTrackForm onAdd={add} addedBy={{peerId: room.selfId, name}} />
              <Queue
                state={room.state}
                onRemove={id => room.send({type: 'remove', trackId: id})}
                onReorder={(trackId, toIndex) => room.send({type: 'reorder', trackId, toIndex})}
              />
            </div>
          }
          chat={
            <ChatPanel
              messages={room.messages}
              selfId={room.selfId}
              composer={
                <ChatComposer
                  onSend={body => room.sendChat('text', body)}
                  soundToggle={
                    <button
                      onClick={() => {
                        const next = !muted
                        setMuted(next)
                        saveSoundMuted(window.localStorage, next)
                      }}
                      data-testid="sound-toggle"
                      // A toggle button carries its state in `aria-pressed` and
                      // keeps a STABLE name. Swapping the label as well would
                      // announce "Turn on message sounds, pressed" while muted —
                      // each half correct, the pair contradictory.
                      aria-pressed={muted}
                      aria-label="Mute message sounds"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-raised hover:text-text cursor-pointer"
                    >
                      {muted ? <VolumeX size={18} aria-hidden /> : <Volume2 size={18} aria-hidden />}
                    </button>
                  }
                  gifSlot={
                    gifsEnabled ? (
                      <GifPicker onPick={url => room.sendChat('gif', url)} />
                    ) : null
                  }
                />
              }
            />
          }
        />
      </aside>

      <Toasts items={toasts} onDismiss={dismissToast} />
    </main>
  )
}

function PlayerOverlay({
  children,
  action,
}: {
  children: React.ReactNode
  action?: {label: string; onClick(): void}
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[var(--space-3)] bg-[var(--scrim)] p-[var(--space-4)] text-center">
      <p className="max-w-sm text-sm text-text">{children}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="rounded-[var(--radius-md)] border border-border px-[var(--space-3)] py-[var(--space-2)] text-sm text-text hover:bg-surface-raised cursor-pointer"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
