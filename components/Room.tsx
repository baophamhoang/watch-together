'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import {SkipForward} from 'lucide-react'
import {AddTrackForm} from './AddTrackForm'
import {Queue} from './Queue'
import {RoomTabs} from './RoomTabs'
import {loadNickname} from '@/lib/identity'
import type {Track, Unplayable} from '@/lib/sync/types'
import {useRoom} from '@/lib/sync/use-room'
import {useSyncPlayback} from '@/lib/sync/use-sync-playback'
import {useYouTubePlayer} from '@/lib/youtube/use-player'

export function Room({code}: {code: string}) {
  const [name, setName] = useState('friend')
  const positionRef = useRef<() => number>(() => 0)

  useEffect(() => {
    // Reading localStorage must wait until after mount (it doesn't exist on
    // the server), so hydrating the nickname here is unavoidable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(loadNickname(window.localStorage))
  }, [])

  const room = useRoom(code, name, positionRef)

  // Refs keep the player's event callbacks stable, so the player is never
  // rebuilt just because room state changed. `room` is a fresh object every
  // render (see useRoom), so these can't be synced via a dependency array —
  // refreshed every render instead, same as `roomRef` in useSyncPlayback.
  const sendRef = useRef(room.send)
  const trackIdRef = useRef<string | null>(null)
  const isHostRef = useRef(room.isHost)
  useEffect(() => {
    sendRef.current = room.send
    trackIdRef.current = room.state.currentTrackId
    isHostRef.current = room.isHost
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

  const onUserPlay = useCallback(() => sendRef.current({type: 'play'}), [])
  const onUserPause = useCallback(
    (position: number) => sendRef.current({type: 'pause', position}),
    [],
  )

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

  const add = (track: Track) => room.send({type: 'enqueue', track})

  return (
    <main className="flex h-dvh flex-col lg:flex-row">
      {/* The video is the protagonist: it takes every pixel the rail does not. */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="yt-player-shell relative aspect-video w-full shrink-0 bg-black lg:aspect-auto lg:flex-1">
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

      <aside className="flex min-h-0 w-full flex-col border-border lg:w-[380px] lg:shrink-0 lg:border-l">
        {/* Room code + presence status: not part of this task's brief, but the
            current build has them and they're load-bearing for the e2e suite
            (startRoom() waits on data-testid="room-code" before anything else
            runs). Kept per the dispatch's "keep it and say so" instruction —
            re-skinned onto Task 1 tokens since the raw Tailwind colours they
            used are gone. Presence/invite are real tasks later in this plan;
            this is only carrying forward what already existed. */}
        <div className="flex shrink-0 items-center justify-between gap-[var(--space-2)] border-b border-border px-[var(--space-3)] py-[var(--space-2)] text-sm">
          <code
            className="rounded-[var(--radius-sm)] bg-surface-raised px-[var(--space-2)] py-[var(--space-1)] text-text"
            data-testid="room-code"
          >
            {code}
          </code>
          <span className="text-muted" data-testid="status">
            {room.status === 'connected'
              ? `${room.roster.length} watching${room.isHost ? ' · host' : ''}`
              : room.status === 'blocked'
                ? 'network blocked'
                : 'connecting…'}
          </span>
        </div>

        {room.warning && (
          <p className="shrink-0 border-b border-border px-[var(--space-3)] py-[var(--space-2)] text-sm text-warn">
            {room.warning}
          </p>
        )}

        <RoomTabs
          unreadCount={0}
          queue={
            <div className="flex flex-col gap-[var(--space-3)] p-[var(--space-3)]">
              <AddTrackForm onAdd={add} addedBy={{peerId: room.selfId, name}} />
              <Queue
                state={room.state}
                onRemove={id => room.send({type: 'remove', trackId: id})}
              />
            </div>
          }
          chat={
            <p className="p-[var(--space-3)] text-sm text-muted">
              Chat arrives in the next task.
            </p>
          }
        />
      </aside>
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
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[var(--space-3)] bg-black/85 p-[var(--space-4)] text-center">
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
